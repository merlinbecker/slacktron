/*** 
 * ThoughtTron
 * @todo refactor
 * @todo add tests
 * 
 * 
 * ****/

import { app, HttpRequest, HttpResponseInit, input, InvocationContext, output } from "@azure/functions";
import { App } from '@slack/bolt'
import { AzReceiver } from "../utils/AzReceiver"

const { OpenAI } = require("langchain/llms/openai");
import uuid4 from "uuid4"
import { setupAppInsights } from "../utils/AppInsights";
const moment = require("moment");
import { CosmosClient } from "@azure/cosmos"
import axios from "axios"



type MessageItem = {
    "userid": string,
    "id": string,
    "query": string,
    "response": string,
    "timestamp": number,
    "retries": number,
}

type messageevent = {
    client_msg_id: string
    type: string
    text: string
    user: string
    ts: string
    blocks: any
    team: string
    channel: string
    event_ts: string
    channel_type: string
    subtype?: string
    files?: {
        id: string
        created: number
        timestamp: number,
        filetype: string,
        name: string,
        url_private: string
        permalink: string
    }[]
}

const endpoint = process.env['COSMOS_ENDPOINT']
const key = process.env['COSMOS_KEY']
const cosmosdb = new CosmosClient({ endpoint, key });


export async function slackevents(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    setupAppInsights("SlackEvent")

    const verbose = process.env['VERBOSE'] === "TRUE" ? true : false

    const receiver = new AzReceiver(process.env["SLACK_SIGNING_SECRET"], console.log);
    const slackApp = new App({
        token: process.env["SLACK_BOT_TOKEN"],
        signingSecret: process.env["SLACK_SIGNING_SECRET"],
        receiver: receiver,
        processBeforeResponse: true
    })


    //Kommando, um einfach eine Antwort auf den Prompt zu bekommen, ohne Thoughttrons Charakter oder den Gesprächskontext zu haben
    //es wird nur der Kontext aus der Vektordatenbank gezogen, mit Quellenangabe
    slackApp.command('/contextprompt', async ({ command, ack, say }) => {
        // Acknowledge command request
        await ack()

        //check, if message is sent already
        /**
         * @todo 3 Sekunden Ack Problem aufzeigen, und die ganze Funktion auslagern
         * **/
        const database = await cosmosdb.database(process.env["COSMOS_DB_NAME"]);
        const container = await database.container(process.env["COSMOS_CONTAINER_NAME"])

        const { resources } = await container.items.query(`SELECT * from c WHERE c.id = '${command.trigger_id}'`).fetchAll();
        if (resources.length > 0) {
            await container.item(command.trigger_id).replace({
                ...resources[0], retries: resources[0].retries + 1
            })
            return
        } else {
            //dynamic imports
            const { QdrantVectorStore } = await import("langchain/vectorstores/qdrant")
            const { OpenAIEmbeddings } = await import("langchain/embeddings/openai")
            const { RetrievalQAChain, loadQAStuffChain } = await import("langchain/chains")
            const { PromptTemplate } = await import("langchain/prompts")
            const llm = new OpenAI({
                openAIApiKey: process.env["OPENAI_API_KEY"],
                temperature: 0,
                modelName: "gpt-3.5-turbo"
            })
            const vectorStore = await QdrantVectorStore.fromExistingCollection(
                new OpenAIEmbeddings({ verbose: verbose }),
                {
                    url: process.env.QDRANT_URL,
                    apiKey: process.env.QDRANT_TOKEN,
                    collectionName: process.env.QDRANT_COLLECTION
                }
            )
            const promptTemplate = `
            Use the following pieces of context to answer the instruction at the end. 
            If you don't know the answer, just say that you don't know, don't try to make up an answer.
            List the titles of the sources at the end.
            {context}
            Instruction: {question}
            Answer in the language, the instruction ist written in :
            `


            const prompt = PromptTemplate.fromTemplate(promptTemplate);

            const chain = new RetrievalQAChain({
                combineDocumentsChain: loadQAStuffChain(llm, { prompt }),
                retriever: vectorStore.asRetriever(4, {
                    "must": [
                        {
                            "key": "metadata.userid",
                            "match": {
                                "any": [
                                    command.user_id,
                                    "shared"
                                ]
                            }
                        }
                    ]
                }
                ),
                verbose: verbose
            });

            const res = await chain.call({
                query: command.text,
            })
            const output = res.text
            await say(`${output}`)
            await container.items.create({
                userid: command.user_id,
                id: command.trigger_id,
                phase: parseInt(process.env['DEV_PHASE']),
                type: `command ${command.command}`,
                query: command.text,
                response: output,
                timestamp: Math.round(new Date().getTime() / 1000),
                retries: 0
            })
        }
    })


    //bei message kann man auch ein pattern verwenden, wie zb :wave:
    slackApp.message(async ({ message, say }) => {
        const m = message as messageevent
        //add functionalities for shared files
        if (m.subtype == "file_share") {
            if (!m.files) return
            let user = ""
            if (m.channel_type === "im") {
                user = m.user
            }
            else {
                user = m.channel
            }

            const database = await cosmosdb.database(process.env["COSMOS_DB_NAME"]);
            const container = await database.container(process.env["COSMOS_CONTAINER_NAME"])

            const { resources } = await container.items.query(`SELECT * from c WHERE c.id = '${m.client_msg_id}'`).fetchAll();
            if (resources.length > 0) {
                await container.item(m.client_msg_id).replace({
                    ...resources[0], retries: resources[0].retries + 1
                })
                return
            }
            else {
                const sharedURLs = []
                for (let i = 0; i < m.files.length; i++) {
                    const file = m.files[i]
                    switch (file.filetype) {
                        case "png":
                            say("noch nicht untertsützt")
                            break;
                        case "pdf":
                            say("noch nicht unterstützt")
                            break;
                        case "binary":
                            const ext = file.name.split('.').pop();
                            if (ext.toLowerCase() != "gpx") {
                                say("no way")
                                return
                            }
                            await say(":world_map:")
                            sharedURLs.push(file.permalink)
                            try {

                                //download gpx file
                                let res = await axios.get(
                                    file.url_private,
                                    {
                                        responseType: 'arraybuffer',
                                        headers: {
                                            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
                                        }
                                    })
                                const download = res.data

                                //convert to geojson
                                const tj = await import("@tmcw/togeojson")
                                // node doesn't have xml parsing or a dom. use xmldom
                                const DOMParser = require("xmldom").DOMParser;

                                const gpx = new DOMParser().parseFromString(download.toString())
                                const geojson = tj.gpx(gpx)
                                //simplify geojson
                                const simplify = require('simplify-geojson')

                                let simplified: any = geojson
                                let count = simplified.features.reduce((acc, curr) => acc + curr.geometry.coordinates.length, 0)
                                let tolerance = 0.0001
                                while (count > 250) {
                                    simplified = simplify(geojson, tolerance)
                                    tolerance += tolerance
                                    count = simplified.features.reduce((acc, curr) => acc + curr.geometry.coordinates.length, 0)
                                }

                                //eleminate third coord (if any)
                                simplified.features = simplified.features.map(feature => {
                                    feature.geometry.coordinates.map(coord => {
                                        if (coord.length > 2) {
                                            coord.pop()
                                        }
                                        return coord
                                    })
                                    feature.properties = {
                                        description: feature.properties.desc ? feature.properties.desc : "",
                                        title: feature.properties.name ? feature.properties.name : "",
                                        stroke: "#7C1239",
                                        "stroke-width": 4,
                                        "stroke-opacity": 0.8,
                                    }
                                    return feature
                                })

                                //formulate mapbox static images request
                                const mbxStatic = require('@mapbox/mapbox-sdk/services/static')
                                const staticService = mbxStatic({ accessToken: process.env['MAPBOX_TOKEN'] })
                                const imageresult = await (staticService.getStaticImage({
                                    ownerId: 'lordmerlo',
                                    styleId: 'cl400s26a002p14riamyei1d0',
                                    width: process.env['MAP_PIXEL'] ? parseInt(process.env['MAP_PIXEL']) : 1280,
                                    height: process.env['MAP_PIXEL'] ? parseInt(process.env['MAP_PIXEL']) : 1280,
                                    position: "auto",
                                    before_layer: "settlement-subdivision-label",
                                    padding: "50,50,50,50",
                                    attribution: true,
                                    highRes: true,
                                    logo: true,
                                    overlays: [
                                        // Simple markers.
                                        {
                                            geoJson: simplified
                                        }
                                    ]
                                }).send())
                                //download image


                                //upload image to DM
                                const uploadres = await slackApp.client.filesUploadV2({
                                    file: Buffer.from(imageresult.body, 'binary'),
                                    filetype: "image",
                                    channel_id: m.channel,
                                    title: "deine Wanderung",
                                    filename: "map.png",
                                    token: process.env.BOT_TOKEN
                                })

                                /*console.log(uploadres)
                                if (!uploadres.error)
                                    await say({
                                        text: 'Hello world!',
                                        blocks: [
                                            {
                                                type: 'image',
                                                image_url: uploadres.files[0].file.url_private_download as string,
                                                alt_text: 'Linus'
                                            }
                                        ]
                                    })
                                else console.error(uploadres.error)*/
                            } catch (e) {
                                context.error(e)
                            }

                    }
                }


                await container.items.create({
                    userid: m.user,
                    id: m.client_msg_id,
                    phase: parseInt(process.env['DEV_PHASE']),
                    type: "fileshare",
                    query: `${m.text}\n\n ${sharedURLs.join("\n")}`,
                    response: "",
                    timestamp: parseInt(m.ts),
                    retries: 0
                })
            }

        }
        if (m.subtype != undefined) return

        let user = ""
        if (m.channel_type === "im") {
            user = m.user
        }
        else {
            user = m.channel
        }

        const database = await cosmosdb.database(process.env["COSMOS_DB_NAME"]);
        const container = await database.container(process.env["COSMOS_CONTAINER_NAME"])

        const { resources } = await container.items.query(`SELECT * from c WHERE c.id = '${m.client_msg_id}'`).fetchAll();
        if (resources.length > 0) {
            await container.item(m.client_msg_id).replace({
                ...resources[0], retries: resources[0].retries + 1
            })
            return
        }
        else {

            //dynamic imports
            const { QdrantVectorStore } = await import("langchain/vectorstores/qdrant")
            const { OpenAIEmbeddings } = await import("langchain/embeddings/openai")
            const { Document } = await import("langchain/document")
            const { RetrievalQAChain, loadQAStuffChain } = await import("langchain/chains")
            const { PromptTemplate } = await import("langchain/prompts")

            const { resources } = await container.items.query(`SELECT TOP 2 * from c WHERE c.userid='${m.user}' ORDER BY c.timestamp DESC`).fetchAll();
            const history = resources.map(r => {
                return `
                ${user}: ${r.query}
                `
            })

            const llm = new OpenAI({
                openAIApiKey: process.env["OPENAI_API_KEY"],
                temperature: 0,
                modelName: "gpt-3.5-turbo"
            })

            const vectorStore = await QdrantVectorStore.fromExistingCollection(
                new OpenAIEmbeddings({ verbose: verbose }),
                {
                    url: process.env.QDRANT_URL,
                    apiKey: process.env.QDRANT_TOKEN,
                    collectionName: process.env.QDRANT_COLLECTION
                }
            );

            moment.locale('de')

            const version = process.env['VERSION']
            const date = moment().format('LLLL')

            const promptTemplate = `Du bist Thoughttron, ein hilfsbereiter Roboter, der mit seinem Nutzer einen endlosen Chat führt.
    Deine Versionsnummer ist die ${version}
    Deine Aufgabe ist es, die Gedanken des Nutzers zu verwalten, zu ordnen und ihm Auskunft zu geben. 
    Unterscheide:
    Will der Nutzer dir Informationen zukommen lassen, z.B. Termine, Infos über Personen, seine Ziele oder Ideen, oder ein Memo,dann nimm diese entgegen und antworte 
    ihm möglichst kurz. Aber wenn du im Kontext erwähnenswerte Informationen findest, reichere die Antwort damit an.
    Hat der Nutzer eine Frage oder Aufgabe für dich, dann antworte ausführlicher und versuche, genau auf die Aufgabe oder Frage einzugehen.
    Wenn Du Quellenangaben in der Gesprächshistorie findest, liste diese am Ende der Antwort auf.
    Hat der Nutzer eine Instruktion für dich, befolge diese genau.
    Wenn Du die Antwort nicht kennst, sage ehrlich, dass Du es nicht weißt. Erfinde nichts.
    Benutze hauptsächlich die Informationen aus der Gesprächshistorie. 
    Antworte, wie ein Roboter antworten würde, also kurz und prägnant, mit trockenem Technik-Humor. 
    
    In dreifachen Anführungszeichen stehen evtl. Aussagen des Nutzer aus der Gesprächshistorie. 
    Nimm diese Informationen in deine Antwort mit auf
    Gesprächshistorie:
    """{context}
    
    ${history.join("\n")}
    """

    (Du musst diese Informationen nicht verwenden, wenn nicht relevant)
    Heute ist der ${date}
    
    Antworte nun auf folgende Eingabe des Nutzers:
    ${user}: {question}
    Du: `


            const prompt = PromptTemplate.fromTemplate(promptTemplate);

            const chain = new RetrievalQAChain({
                combineDocumentsChain: loadQAStuffChain(llm, { prompt }),
                retriever: vectorStore.asRetriever(4, {
                    "must": [
                        {
                            "key": "metadata.userid",
                            "match": {
                                "any": [
                                    m.user,
                                    "shared"
                                ]
                            }
                        }
                    ]
                }),
                verbose: verbose
            });

            const result = await chain.call({
                query: m.text,
            });

            //embedde den Text
            const uid = uuid4()
            const docs = [new Document(
                {
                    pageContent: `${date} :${m.text}`,
                    metadata: { uid: uid, phase: parseInt(process.env['DEV_PHASE']), type: "message", timestamp: parseInt(m.ts), userid: user }
                })]

            vectorStore.addDocuments(docs)

            await container.items.create({
                userid: m.user,
                id: m.client_msg_id,
                phase: parseInt(process.env['DEV_PHASE']),
                type: "chathistory",
                query: m.text,
                response: result.text,
                timestamp: parseInt(m.ts),
                retries: 0
            })

            await say(`${result.text}`)
        }
    })

    const body = await receiver.requestHandler(request)
    return { status: 200, body: body }
}

app.http('slackevents', {
    methods: ['POST'],
    authLevel: 'function',
    route: "slack/events",
    handler: slackevents,
})