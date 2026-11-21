# V1.1 model research comparison — 21 November 2026

This is a source-code and publication review, not a reproduction of anyone's basketball results. **EdgeLab independently trained/tested zero models on genuine data during this task.** Repository claims below are self-reported; papers are published/preprint evidence on their own populations. No upstream code, fitted coefficient, probability, figure or dataset was copied into the product. Reviewed source files are retained privately under `.local/research` for audit, outside Git.

Different targets, selected populations, seasons and metrics prevent a ranking across repositories. AUC measures ranking, MAE measures point error, and Brier/log loss score probabilities; their numbers are not interchangeable. Team-win results are not player-prop validation.

## 1. pranay123-stack/nba-player-simulator

Reviewed [README](https://github.com/pranay123-stack/nba-player-simulator/blob/4314e824c10ecc926039d23a9327fe893db52456/README.md), [minutes implementation](https://github.com/pranay123-stack/nba-player-simulator/blob/4314e824c10ecc926039d23a9327fe893db52456/src/nba_sim/models/minutes.py), baseline/backtest code and research note at commit `4314e824c10ecc926039d23a9327fe893db52456`.

- **Target/method:** joint full box scores, including the four initial props; independent NB2, uncertain minutes, observable-context and shared-factor ablations.
- **Inputs/minutes:** decayed rates, prior minutes, roster rank and game context; separate play probability, conditional minutes and overtime, followed by team-minute allocation.
- **Availability:** pregame active list assumed known; its historical publication timestamps are unavailable. No historical injury/starting-lineup feed establishes that assumption.
- **Evaluation:** self-reported 93,848 active player-games per model, 3,690 fixtures, 2021–22 through 2023–24. CRPS, intervals and clustered comparisons favour uncertain minutes more clearly than the dependence layer.
- **Limits/budget:** dataset mirror licensing does not establish our intended usage permission. Full joint simulation is a larger CPU/data undertaking. No genuine run reproduced here.
- **Component to test:** separate participation/minutes/production and a fixed-minutes ablation with date/fixture-clustered uncertainty. Implemented independently in the V1.1 research harness; not activated.

## 2. eduardo00-fv/nba-props-model

Reviewed [write-up](https://github.com/eduardo00-fv/nba-props-model/blob/31bf4a7c4621342a8d0d6d52e0f612ca5949973e/README.md), metrics artefact, feature schema and [minutes experiment](https://github.com/eduardo00-fv/nba-props-model/blob/31bf4a7c4621342a8d0d6d52e0f612ca5949973e/docs/minutes-experiment.md).

- **Target/method:** PTS/REB/AST/3PM means with XGBoost, simulated marginal distributions and per-market Platt scaling. Required rolling, season, venue, pace/usage and market-line inputs are described; training implementation and data are private.
- **Minutes/injuries:** the disclosed experiment distinguishes actual-game minutes and retrospective absences from an inference-available proxy; the proxy did not retain the appealing oracle gain.
- **Evaluation:** self-reported 2025–26 playoff holdout after earlier seasons/regular season, 1,558 player-games; MAE against L5/L10, bias, Brier/log loss, and selected forecast hit rates. Public calibration measurements fit/evaluate the same forecast sample, so they do not prove held-out calibration.
- **Limits/budget:** private training code/data prevent reproduction. The restrictive write-up licence grants no implementation/dataset reuse. No measurements are imported as EdgeLab performance.
- **Component to test:** train/serve parity for minutes and fully separate calibration fit/selection/test windows. The new harness uses those separations; a large external ML stack is deferred until a real sample justifies it.

## 3. rnsapountzis/nba-player-props-ml-pipeline

Reviewed [README](https://github.com/rnsapountzis/nba-player-props-ml-pipeline/blob/16af0934b8288b3fff57d50b9528866a3f1e94b3/README.md), [walk-forward code](https://github.com/rnsapountzis/nba-player-props-ml-pipeline/blob/16af0934b8288b3fff57d50b9528866a3f1e94b3/validation/walk_forward.py), prior-season builder and licence notice.

- **Target/method:** points/rebounds/assists classifiers and multiple tree/linear ensembles. Direct line exceedance and a form/streak target are different problems; the reported AUCs cannot be compared as the same outcome.
- **Inputs/minutes/availability:** extensive rolling/context/prior-season features and private pregame sources. A separate validated participation/minutes probability distribution is not established by the published subset.
- **Evaluation:** self-reported approximately 112K rows over 2019–20 to 2025–26, six date-based expanding folds; AUC and feature-ablation rules. Synthetic analysis lines are disclosed and do not establish genuine quote-relative profit.
- **Limits/budget:** source/data/artifacts are incomplete. Correlation leak heuristics are diagnostics, not a substitute for timestamp lineage. Recreating hundreds of features exceeds available source coverage.
- **Component to test:** prior-season-only joins and ablations, alongside direct perturbation tests. No fuzzy identity joins or substitute analysis prices enter Signals.

## 4. johnshun001/nba-props

Reviewed [README](https://github.com/johnshun001/nba-props/blob/dab2a2804409ba98e2d7b37b076aaf2decd76792/README.md), [ensemble/split implementation](https://github.com/johnshun001/nba-props/blob/dab2a2804409ba98e2d7b37b076aaf2decd76792/models/ensemble.py), calibrator, minutes and prior-feature modules.

- **Target/method:** PTS/REB/AST quantiles from boosted, forest and optional neural members; conformal intervals and isotonic probability calibration.
- **Inputs/minutes:** shifted rolling player features and backward joins on prediction time. Minutes/lineup uncertainty modules exist; their inclusion is not proof of a measured gain.
- **Evaluation:** self-reported 2,645 player-games/ten players in the tracked database; held-out 24 February–13 April 2025 point-error results. Training, selection, calibration and test splits are explicitly ordered in code.
- **Availability/calibration limits:** README says calibration remains unfit because lined evidence is insufficient. Public calibrator helper can fit/score a supplied replay sample; correct calling scope remains essential. Same-date/name fallbacks are weaker identity evidence than Signals requires.
- **Budget/component:** retain separate chronological stages and fail-closed calibration readiness. Test a small distributional boosted challenger first. Its execution/accounting architecture is outside our scope and was not adopted. No genuine results independently reproduced.

## 5. DanielTomaro13/Basketball-Modelling

Reviewed [simulation](https://github.com/DanielTomaro13/Basketball-Modelling/blob/5969f1fb909f9b03d2bfc6cccbe1a7ee7802175d/src/sim.py), [evaluation](https://github.com/DanielTomaro13/Basketball-Modelling/blob/5969f1fb909f9b03d2bfc6cccbe1a7ee7802175d/src/evaluate.py), game-log module, configuration, README and backtest JSON.

- **Target/method:** multi-league team markets and player props; player rates × projected minutes, Normal marginals for larger counts and Poisson for selected low counts. Combo variance is heuristic rather than an estimated joint distribution.
- **Inputs/minutes/availability:** league profiles, player season production, pace/opponent scaling and externally supplied minutes. A validated positive-availability/participation model is not established by the reviewed evidence.
- **Evaluation:** published artifact contains 200 NBL team-game outcomes for a 2025 holdout, with team-win Brier/log loss and Elo/home comparators. That is **not** an evaluation of NBL player-prop probabilities.
- **Limits/budget:** paused automated refresh disclosed. Public ESPN/Rosetta extraction is not our usage authorisation. Static simulation is inexpensive but does not solve data rights or marginal calibration.
- **Component to test:** explicit league duration/baseline separation and opponent-context ablations only when permitted point-in-time data exists. Do not inherit heuristic combo correlation or treat its team score as prop evidence.

## 6. KRlSHP/nba_sim

Reviewed [distribution heads](https://github.com/KRlSHP/nba_sim/blob/529752a2ffa8944e7cb8858eba864d6c7431a933/src/nba_sim/models/heads.py), [split configuration](https://github.com/KRlSHP/nba_sim/blob/529752a2ffa8944e7cb8858eba864d6c7431a933/configs/data.yaml), split code, README and metrics JSON.

- **Target/method:** hierarchical neural full box scores: Dirichlet minute allocation, NB counts, and binomial makes conditional on attempts. Shared/team embeddings require broad roster, player and context data.
- **Minutes/injuries:** team-minute conservation; README acknowledges individual draws can exceed regulation minutes and that injury masking is deferred.
- **Evaluation:** self-reported 2024–25 held-out MAE/interval/constraint metrics, including points MAE about 3.71. Exact independent sample accounting is not established by that headline alone.
- **Critical audit:** checked configuration puts 2025 in training while 2024 is both validation and test. This does not establish an untouched strictly-later test, irrespective of prior-only rolling features. The published metrics cannot be promoted as clean forward evidence here.
- **Budget/component:** GPU-scale neural training is unjustified with zero permitted rows. Test attempts/makes coherence and explicit duration caps in a small CPU model; retain disjoint global dates. No weights, code or source data adopted.

## 7. NGBoost — Duan et al., ICML 2020

Reviewed [paper](https://proceedings.mlr.press/v119/duan20a/duan20a.pdf) and [publication](https://proceedings.mlr.press/v119/duan20a.html).

- **Target/method:** general conditional probability distributions using multiparameter natural-gradient boosting and proper scoring rules. This is not an NBA/NBL prop study.
- **Inputs/minutes/injuries:** arbitrary covariates; basketball exposure, participation and availability must be designed separately.
- **Evaluation:** tabular regression benchmark datasets and predictive likelihood comparisons; no player-game cohort, pregame injury archive, sportsbook price baseline or basketball gain is supplied.
- **Limits/budget:** the paper motivates distributional evaluation, not universal superiority or using a continuous marginal for discrete counts. An authentic NGBoost implementation adds a separate dependency/runtime and requires enough data.
- **Component to test:** compare full distributions with NLL/CRPS, not only mean error. Current CPU challenger is explicitly log-count boosted stumps with residual NB uncertainty, **not a reproduction of NGBoost, XGBoost or LightGBM**. External-library challengers remain data-dependent future experiments.

## 8. Walsh and Joshi — arXiv:2303.06021v4

Reviewed [full paper](https://arxiv.org/html/2303.06021v4).

- **Target/method:** NBA **team winners**, comparing accuracy-led versus calibration-led model/feature/hyperparameter selection over LR/RF/SVM/MLP candidates.
- **Inputs/minutes/injuries:** relative team box-score features; no player-minute or player-availability distribution.
- **Evaluation:** 2014–16 initial training, 2016–17 validation, 2017–18 model selection, and 2018–19 betting simulation with published odds. Reported returns favour calibration-led selection on that experiment.
- **Limits:** one later betting season, strategy/market dependence and team-win target mean its ROI cannot be transferred to player props. Calibration selection is not a proof of EdgeLab edge.
- **Budget/component:** use proper probability scoring, disjoint selection and calibration stages, and a separate genuine market benchmark. Do not adopt the paper's staking strategy or any reported ROI as a product assumption. No reproduction here.

## 9. Watts — arXiv:2611.10152v2

Reviewed [full preprint](https://arxiv.org/html/2611.10152v2), available before this audit date.

- **Target/method:** joint PTS/REB/AST threshold exceedances with player-specific Gaussian copula and empirical marginals; empirical joint frequency and independent marginals are comparators.
- **Inputs/minutes/injuries:** prior player games; sample restricted to nonzero-minute appearances. No pregame participation/injury model, made-three model or source-timestamp archive is demonstrated.
- **Evaluation:** 207 selected players, approximately 22K outcomes across seven two-season windows; per-game refits and log loss over 27 threshold combinations. Reported gains depend on threshold level and sample depth.
- **Limits:** starter selection and minimum-appearance restrictions condition the population; multiple thresholds are correlated. Joint-event performance does not establish marginal calibration, live availability or price-relative EV.
- **Budget/component:** a regularised copula/paired bootstrap is a later combinations experiment. V1.1 keeps combinations disabled; no independence multiplication, coefficients or claimed gains were imported.

## EdgeLab decision

Implement and test small competing candidates and strict information boundaries first. A simple control remains selectable; an ensemble must improve an earlier window and then face the same untouched test. Neither additional complexity nor correlated agreement earns promotion. Genuine source access, coherent held-out calibration and later frozen monitoring remain prerequisites. See [evaluation protocol/results](v11-model-evaluation.md) and [source findings](v11-data-provider-findings.md).
