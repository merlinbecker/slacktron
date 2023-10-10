
import * as appInsights from 'applicationinsights'

export function setupAppInsights(instanceName) {
    appInsights
        .setup(process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'])
        .setAutoCollectPerformance(true, true)
        .setSendLiveMetrics(true)
        .setAutoCollectDependencies(false)
        .setAutoCollectIncomingRequestAzureFunctions(true)
        .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
        .start()
    appInsights.defaultClient.config.samplingPercentage = process.env['MONITORING_SAMPLING_RATE']
        ? parseInt(process.env['MONITORING_SAMPLING_RATE'])
        : 100

    appInsights.defaultClient.addTelemetryProcessor(envelope => {
        envelope.tags['ai.cloud.role'] = process.env['AI_ROLE']
        envelope.tags['ai.cloud.roleInstance'] = instanceName
        return true
    })
}