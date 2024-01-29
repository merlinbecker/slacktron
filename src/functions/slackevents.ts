import { app, HttpRequest, HttpResponseInit, input, InvocationContext, output } from '@azure/functions'
import { App } from '@slack/bolt'
import { AzureFunctionsReceiver } from '../utils/AzReciever'
import { MessageEvent } from '../utils/types'
import { version } from '../../package.json';

import { CosmosDB } from "../utils/Cosmosdb"
import { setupAppInsights } from "../utils/AppInsights"

const getVersion = () => {
    return `My version is ${version}`
}
const reverseText = (m: MessageEvent) => {
    return [...m.text].reverse().join("");
}

const checkConfiguration = () => {
    if (!(process.env["SLACK_SIGNING_SECRET"] && process.env["SLACK_BOT_TOKEN"])) {
        throw new Error("configuration incomplete")
    }
}

const cosmosclient = new CosmosDB({
    key: process.env['COSMOS_KEY'],
    endpoint: process.env['COSMOS_ENDPOINT'],
    database: process.env["COSMOS_DB_NAME"],
    container: process.env["COSMOS_CONTAINER_NAME"]
})

export async function slackevents(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {

    const servicename = process.env['SERVICENAME'] ?? "Slacktron"
    setupAppInsights("SlackEvent", servicename)

    //check for complete configuration
    checkConfiguration()

    //connect to cosmosContainer
    await cosmosclient.init(servicename)

    const receiver = new AzureFunctionsReceiver(process.env["SLACK_SIGNING_SECRET"], console.log)
    const slackApp = new App({
        token: process.env["SLACK_BOT_TOKEN"],
        signingSecret: process.env["SLACK_SIGNING_SECRET"],
        receiver: receiver,
        processBeforeResponse: true
    })

    slackApp.command('/version', async ({ command, ack, say }) => {
        await ack()
        const answer = await cosmosclient.preCheckAndProcess({
            identifier: command.trigger_id,
            callback: getVersion,
            messagetext: command.text,
            userid: command.user_id
        },)
        if (answer) say(answer)
    })

    slackApp.message(async ({ message, say }) => {
        const m = message as MessageEvent
        if (message.subtype === undefined || message.subtype === 'bot_message') {
            let user = ""
            if (m.channel_type === "im") {
                user = m.user
            }
            else {
                user = m.channel
            }
            const answer = await cosmosclient.preCheckAndProcess({
                identifier: m.client_msg_id,
                callback: reverseText,
                callbackArgs: m,
                messagetext: m.text,
                userid: user
            },)
            if (answer) say(answer)
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