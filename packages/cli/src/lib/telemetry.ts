import Telemetry, { TELEMETRY_FROM } from "rover-telemetry";

export const getTelemetry = (): Telemetry | undefined => {
    let telemetry;

    try {
        telemetry = Telemetry.load(TELEMETRY_FROM.CLI);
    } catch (_err) {
        // Ignore telemetry errors
    }

    return telemetry;
}