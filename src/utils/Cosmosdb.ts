import { Container, CosmosClient, Database } from "@azure/cosmos"

type MessageItem = {
    userid: string,
    id: string,
    query: string,
    response: string,
    timestamp: number,
    retries: number
}

export type CosmosConfig = {
    endpoint: string, key: string, database: string, container: string,
    client?: any
}


export class CosmosDB {
    private client: CosmosClient
    private database: Database
    private container: Container
    private config: CosmosConfig
    private domain: string

    constructor(config: CosmosConfig) {
        try {
            this.config = config
            if (!this.config.client) {
                this.client = new CosmosClient({ endpoint: this.config.endpoint, key: this.config.key })
            }
            else {
                this.client = this.config.client
            }
        } catch (e) {
            throw new Error("CosmosDB connection is not initialized properly");
        }
    }

    async init(domain: string) {
        this.domain = domain
        try {
            if (!this.database)
                this.database = await this.client.database(this.config.database)
            if (!this.container)
                this.container = await this.database.container(this.config.container)
        }
        catch (e) {
            throw new Error("CosmosDB connection is not initialized properly")
        }
    }

    async preCheckAndProcess(config: {
        additionalData?: {},
        identifier: string,
        messagetext: string,
        userid: string
        callback: (args?: {}) => string,
        callbackArgs?: any
    }) {

        const query = "SELECT * from c WHERE c.id = @identifier and c.domain=@domain"
        const parameters = [{ name: "@identifier", value: config.identifier }, { name: "@domain", value: this.domain }]
        const { resources } = await this.container.items.query({ query, parameters }).fetchAll()

        if (resources.length > 0) {
            const replaceWith: MessageItem = {
                ...resources[0], retries: resources[0].retries + 1
            }
            await this.container.item(config.identifier).replace(replaceWith)
            return null
        } else {
            const result = config.callback(config.callbackArgs)
            try {
                await this.container.items.create({
                    id: config.identifier,
                    userid: config.userid,
                    query: config.messagetext,
                    response: result,
                    timestamp: Math.round(new Date().getTime() / 1000),
                    retries: 0,
                    domain: this.domain,
                    ...config.additionalData

                })
            } catch (e) {
                throw new Error("Could not insert items into database")
            }
            return result

        }
    }
}