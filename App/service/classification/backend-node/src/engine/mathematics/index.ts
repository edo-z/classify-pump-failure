/**
 * Mathematics module exports
 */

export { freqEq2dp, freqEqExact, freqBelowSetpoint, freqAtOrBelowSetpoint, freqReachedSetpoint, freqNotReachedSetpoint, freqNearSetpoint } from "./frequency.ts";
export { computeTA, getTAParams, computeCMA, computeMA, extractHistoricalCurrents, checkDeviation, checkNearReference, checkFluctuation, type MAResult } from "./moving-average.ts";
export { calculateUnbalance, checkUnbalance, formatUnbalanceCondition, type UnbalanceResult } from "./three-phase.ts";
export { aggregateReadings } from "./aggregate.ts";