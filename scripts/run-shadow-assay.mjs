#!/usr/bin/env node
import { createAgentSectionDescentAssay } from "@red-cup-engineering/agent-section-descent-assay-service";
import { createAlpacaHistoricalBarsService } from "@red-cup-engineering/alpaca-market-data-read-service";
import { createBrokerageMarketEventRecorder } from "@red-cup-engineering/brokerage-independent-witness-and-books";
import { assayCausalPanel } from "@red-cup-engineering/causal-market-panel-assay-service";
import { createCausalPortfolioLearningCircuit } from "@red-cup-engineering/causal-portfolio-learning-service";
import { measureCausalPatchNovelty } from "@red-cup-engineering/causal-tiling-novelty-measurement-service";
import { measureCorrelationGraph } from "@red-cup-engineering/correlation-graph-measurement-service";
import { createContentAddressedDatasetStore } from "@red-cup-engineering/content-addressed-dataset-store-service";
import { fitDeterministicRidge, predictDeterministicRidge } from "@red-cup-engineering/deterministic-ridge-fit-service";
import { allocateMandatePortfolio } from "@red-cup-engineering/mandate-portfolio-allocation-service";
import { selectModelCandidate } from "@red-cup-engineering/model-tournament-service";
import { formPurgedWalkForwardFolds } from "@red-cup-engineering/purged-walk-forward-fold-service";
import { measureReturnRiskFeatures } from "@red-cup-engineering/return-risk-feature-measurement-service";
import { startLocalWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-rdf-projection-service/local-provider";
import { measureSheafLaplacian } from "@red-cup-engineering/sheaf-laplacian-measurement-service";
import { replayTransactionCosts } from "@red-cup-engineering/transaction-cost-replay-service";

const required = (name) => {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
};
const symbols = [...new Set((process.env.BROKERAGE_SHADOW_UNIVERSE ?? "BLK,QQQ,SPY,TLT,GLD").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean))].sort();
if (!symbols.includes("SPY") || symbols.length < 3) throw new Error("BROKERAGE_SHADOW_UNIVERSE must contain SPY and at least three symbols");
required("ALPACA_ACCOUNT_ESTHER_PAPER_TRADING_KEY");
required("ALPACA_ACCOUNT_ESTHER_PAPER_TRADING_SECRET");
required("BROKERAGE_BOOKS_DATA_ROOT");
required("BROKERAGE_BOOKS_ACCOUNT");
required("BROKERAGE_DATASET_STORE_ROOT");

const witnessJournal = await startLocalWitnessJournalProviderProcess({ port: Number(process.env.WITNESS_JOURNAL_LOCAL_PORT ?? 19764) });
try {
  const env = { ...process.env, WITNESS_JOURNAL_RDF_AGENT: witnessJournal.agentCardUrl };
  const recordMarketManifest = createBrokerageMarketEventRecorder({ originatingActor: "urn:ame:alpaca-market-data-read-service", nodeId: "alpaca-market-data-read-service" }, env);
  const datasetStore = createContentAddressedDatasetStore({ root: env.BROKERAGE_DATASET_STORE_ROOT });
  const marketRecorder = async (event) => {
    const value = event?.value;
    const manifest = await datasetStore.storeDataset({ dataset: value, observedAt: event.recordedAt, provenance: [`urn:alpaca:request:${value.venueRequestId ?? "unavailable"}`] });
    const counts = Object.fromEntries(Object.entries(value.bars ?? {}).map(([symbol, bars]) => [symbol, bars.length]));
    return recordMarketManifest({ ...event, value: { type: "AlpacaHistoricalBarsDatasetManifestObservation", version: 1, dataset: manifest, symbols: value.symbols, start: value.start, end: value.end, feed: value.feed, adjustment: value.adjustment, venueRequestId: value.venueRequestId, counts, orderEffect: false } });
  };
  const resultRecorder = createBrokerageMarketEventRecorder({ originatingActor: "urn:ame:causal-portfolio-learning-service", nodeId: "causal-portfolio-learning-service" }, env);
  const marketData = createAlpacaHistoricalBarsService(env, { recordObservation: marketRecorder });
  const asOf = new Date(process.env.BROKERAGE_SHADOW_AS_OF ?? new Date().toISOString()).toISOString();
  const years = Number(process.env.BROKERAGE_SHADOW_HISTORY_YEARS ?? 5);
  if (!Number.isFinite(years) || years < 2 || years > 10) throw new Error("BROKERAGE_SHADOW_HISTORY_YEARS must be between 2 and 10");
  const start = new Date(Date.parse(asOf) - years * 365.25 * 86_400_000).toISOString();
  const observation = await marketData.readDailyBars({ symbols, start, end: asOf, feed: process.env.BROKERAGE_SHADOW_FEED ?? "iex", adjustment: "all" });
  const assayAgentSectionDescent = createAgentSectionDescentAssay({ measureSheafLaplacian });
  const providers = { assayAgentSectionDescent, assayCausalPanel, measureCausalPatchNovelty, measureCorrelationGraph, fitDeterministicRidge, predictDeterministicRidge, allocateMandatePortfolio, selectModelCandidate, formPurgedWalkForwardFolds, measureReturnRiskFeatures, measureSheafLaplacian, replayTransactionCosts };
  const circuit = createCausalPortfolioLearningCircuit({ providers, recordResult: resultRecorder });
  const result = await circuit({
    barsBySymbol: observation.bars,
    benchmark: "SPY",
    asOf,
    mandate: {
      type: "PortfolioAllocationMandate",
      id: "urn:mandate:esther-paper-shadow-diversified-v1",
      maximumWeight: Number(process.env.BROKERAGE_SHADOW_MAXIMUM_WEIGHT ?? 0.5),
      grossLimit: 1,
      leverageLimit: 1,
      shorting: false,
      maximumDrawdown: Number(process.env.BROKERAGE_SHADOW_MAXIMUM_DRAWDOWN ?? 0.35),
    },
    config: {
      horizon: 5,
      cadence: 5,
      warmup: 252,
      trainingWindow: 504,
      graphWindow: 60,
      patchSize: 5,
      ridge: 1,
      transactionCostBps: Number(process.env.BROKERAGE_SHADOW_TRANSACTION_COST_BPS ?? 10),
    },
  });
  console.log(JSON.stringify({
    type: "InstitutionalInvestmentShadowAssaySummary",
    asOf: result.asOf,
    symbols: result.entities,
    marketObservation: observation.id,
    marketRecord: observation.independentBooksReceipt.graph ?? observation.independentBooksReceipt.id,
    learningRecord: result.independentRecordReceipt.graph ?? result.independentRecordReceipt.id,
    folds: result.folds,
    selected: result.tournament.selectedUsingValidationOnly,
    evaluations: result.evaluations,
    currentDecision: result.currentDecision,
    claims: result.claims,
    orderEffect: false,
  }, null, 2));
} finally {
  await witnessJournal.close();
}
