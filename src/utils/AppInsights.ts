/** 
 * functionality to setup and configure application insights
 * 
**/

import { setup, defaultClient, DistributedTracingModes } from 'applicationinsights'

export function setupAppInsights(instanceName, servicename) {
    setup(process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'])
        .setAutoCollectPerformance(true, true)
        .setSendLiveMetrics(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectIncomingRequestAzureFunctions(true)
        .setDistributedTracingMode(DistributedTracingModes.AI_AND_W3C)
        .start()

    defaultClient.config.samplingPercentage = process.env['MONITORING_SAMPLING_RATE']
        ? parseInt(process.env['MONITORING_SAMPLING_RATE'])
        : 100

    defaultClient.addTelemetryProcessor(envelope => {
        envelope.tags['ai.cloud.role'] = servicename
        envelope.tags['ai.cloud.roleInstance'] = instanceName
        return true
    })
}