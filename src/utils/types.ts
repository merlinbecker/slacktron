export type MessageEvent = {
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