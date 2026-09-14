/**
 * The fixed report set. Committed, versioned, reviewed in pull requests.
 *
 * This is the difference between an experiment and a process. An experiment is
 * "I tried it and it seemed to decide sensibly". A process is a set of reports
 * someone agreed on in advance, a rule for what counts as passing, and a number
 * that either moves or does not when you change the model.
 *
 * What is being measured is narrower than it looks. `classify()` is a pure
 * function — given the same facts it always returns the same branch, and
 * `bun run policy` checks that for free. The model's job is the step before:
 * reading a code agent's prose and extracting the facts the rule consults. So
 * these cases hold the *analysis text* fixed and vary the model, which isolates
 * the one place a model choice can send a report down the wrong branch.
 *
 * Each case is built to exercise one check. Change a policy constant and
 * exactly the cases that hang off it should move.
 */
import type { Analysis, ClassificationKind } from '@bugtriage/shared'
import { promotedEvalCases } from './promoted'

export type EvalCase = {
  id: string
  title: string
  body: string
  /** What the read-only agent reported. Frozen, so the model is the variable. */
  analysisText: string
  /** The branch this report must take. */
  expected: ClassificationKind
  /** Which policy check this case exists to exercise. */
  exercises: string
  /**
   * The facts a careful reader would extract. Ground truth for the pure-policy
   * probe, and the yardstick for what the model got wrong when it disagrees.
   */
  expectedAnalysis: Analysis
  /** How well the docs cover the behaviour. Frozen alongside the analysis. */
  docsConfidence: number
}

const BASE_DATASET: EvalCase[] = [
  {
    id: 'sidebar-overflow',
    title: 'Long project names overflow the sidebar',
    body: 'A project named "production-eu-west-analytics-pipeline" runs past the edge of the sidebar and covers the settings icon. Shorter names are fine.',
    analysisText:
      'The sidebar item renders the project name in a fixed-width flex child with no overflow handling. ' +
      'The fix is a CSS change in components/Sidebar.tsx: add truncation with an ellipsis and a title attribute. ' +
      'No layout other than that item is affected, no data changes, no new packages. The name is still fully readable on hover.',
    expected: 'simple-fix',
    exercises: 'the happy path: contained, no behaviour change, confident analysis',
    expectedAnalysis: {
      summary: 'Sidebar project names are not truncated and overflow their container.',
      filesTouched: ['components/Sidebar.tsx'],
      changesBehaviour: 'no',
      needsNewDependency: 'no',
      looksIntentional: 'no',
      confidence: 0.9,
    },
    docsConfidence: 0.372,
  },
  {
    id: 'crash-empty-repo',
    title: 'Analysis crashes on a repository with no commits',
    body: 'Pointing the analyser at a freshly created empty repo throws "Cannot read properties of undefined (reading sha)" instead of reporting that there is nothing to analyse.',
    analysisText:
      'analysis/collect.ts assumes at least one commit and dereferences head.sha unguarded. ' +
      'Adding a guard that returns an empty result when the repository has no commits fixes it. ' +
      'One file, no dependency changes, and the behaviour for every non-empty repository is unchanged.',
    expected: 'simple-fix',
    exercises: 'the happy path, with an error rather than a visual fault',
    expectedAnalysis: {
      summary: 'Collecting analysis on a repository with no commits dereferences an undefined head.',
      filesTouched: ['analysis/collect.ts'],
      changesBehaviour: 'no',
      needsNewDependency: 'no',
      looksIntentional: 'no',
      confidence: 0.88,
    },
    docsConfidence: 0.474,
  },
  {
    id: 'date-format',
    title: 'Deployment timestamps show in US date format',
    body: 'Deployment times read 03/09/2026, which everyone here reads as 3 September when it means 9 March. Please use the local format.',
    analysisText:
      'Timestamps are formatted with a hardcoded en-US locale in lib/format.ts, used by eleven components. ' +
      'Switching to the viewer locale changes what every date in the product looks like for every user, ' +
      'including exported reports and the audit log, which some customers parse. Two files to change, ' +
      'but the effect is product-wide.',
    expected: 'needs-human',
    exercises: 'the behaviour-change check: small diff, wide blast radius',
    expectedAnalysis: {
      summary: 'Dates are formatted with a hardcoded US locale used across the product.',
      filesTouched: ['lib/format.ts', 'lib/export.ts'],
      changesBehaviour: 'yes',
      needsNewDependency: 'no',
      looksIntentional: 'no',
      confidence: 0.85,
    },
    docsConfidence: 0.344,
  },
  {
    id: 'csv-export',
    title: 'Cannot export the metrics table',
    body: 'There is no way to get the metrics table out of the product. A CSV download would do.',
    analysisText:
      'No export exists. Implementing one means adding a CSV serialisation library, a new endpoint, ' +
      'and a button in the metrics view. This is a new capability rather than a repair of existing behaviour.',
    expected: 'needs-human',
    exercises: 'the dependency check, and a feature wearing a bug report as a coat',
    expectedAnalysis: {
      summary: 'The product has no export capability; the report is a request for a new feature.',
      filesTouched: ['api/metrics.ts', 'components/MetricsTable.tsx'],
      changesBehaviour: 'yes',
      needsNewDependency: 'yes',
      looksIntentional: 'no',
      confidence: 0.8,
    },
    docsConfidence: 0.339,
  },
  {
    id: 'vague-slowness',
    title: 'Everything is slow sometimes',
    body: 'The dashboard takes ages to load. Not always. It was fine last week. Maybe since the update?',
    analysisText:
      'Could not reproduce. The dashboard issues four queries; none is obviously pathological in isolation. ' +
      'Without a timestamp, a trace, or an affected account I cannot tell whether this is the reported ' +
      'update, a data-volume effect, or unrelated. I was not able to identify a file to change.',
    expected: 'needs-human',
    exercises: 'the confidence floor: the process refusing to act on what it does not know',
    expectedAnalysis: {
      summary: 'Not reproducible from the report; no specific cause or file identified.',
      filesTouched: [],
      changesBehaviour: 'no',
      needsNewDependency: 'no',
      looksIntentional: 'no',
      confidence: 0.2,
    },
    docsConfidence: 0.301,
  },
  {
    id: 'wide-refactor',
    title: 'Error messages are inconsistent across the API',
    body: 'Some endpoints return {error: "..."} and others {message: "..."}. Our client has to handle both.',
    analysisText:
      'Confirmed. Thirty-one handlers across nineteen files construct error responses independently. ' +
      'Unifying them is mechanical but touches every route, and any client relying on the current ' +
      'shape of a given endpoint would break.',
    expected: 'needs-human',
    exercises: 'the scope check: a real, well-understood bug that is simply too large',
    expectedAnalysis: {
      summary: 'Error response shapes are inconsistent across nineteen files of route handlers.',
      filesTouched: [
        'api/routes/a.ts',
        'api/routes/b.ts',
        'api/routes/c.ts',
        'api/routes/d.ts',
        'api/routes/e.ts',
      ],
      changesBehaviour: 'yes',
      needsNewDependency: 'no',
      looksIntentional: 'no',
      confidence: 0.9,
    },
    docsConfidence: 0.305,
  },
  {
    id: 'preview-expiry',
    title: 'Preview deployments disappear after a few days',
    body: 'I opened a preview URL from a PR I made last week and it 404s now. It worked when the PR was open.',
    analysisText:
      'This is the documented lifecycle rather than a fault. Preview environments are torn down when ' +
      'their pull request closes; the code does exactly what the documentation describes, and the ' +
      'teardown is deliberate — it is what keeps preview environments from accumulating.',
    expected: 'not-a-bug',
    exercises: 'the documented-behaviour branch: the reporter is wrong, and deserves a good answer',
    expectedAnalysis: {
      summary: 'Preview environments are removed when their pull request closes, as documented.',
      filesTouched: [],
      changesBehaviour: 'no',
      needsNewDependency: 'no',
      looksIntentional: 'yes',
      confidence: 0.85,
    },
    docsConfidence: 0.63,
  },
  {
    id: 'env-not-inherited',
    title: 'Environment variables are not shared between services',
    body: 'I set DATABASE_URL on one service and another service in the same project cannot see it. Surely they should share?',
    analysisText:
      'Working as designed. Variables are scoped per service and shared explicitly by linking them, ' +
      'which the documentation covers. The isolation is intentional — it is what stops one service ' +
      'picking up another service’s credentials by accident.',
    expected: 'not-a-bug',
    exercises: 'documented behaviour where the reporter wanted something reasonable',
    expectedAnalysis: {
      summary: 'Environment variables are scoped per service by design and shared by explicit linking.',
      filesTouched: [],
      changesBehaviour: 'no',
      needsNewDependency: 'no',
      looksIntentional: 'yes',
      confidence: 0.88,
    },
    docsConfidence: 0.544,
  },

  /* --------------------------------------------------- silence is not a no -- */

  {
    id: 'work-already-done',
    title: 'Long project names overflow the sidebar',
    body: 'A project named "production-eu-west-analytics-pipeline" runs past the edge of the sidebar and covers the settings icon. Shorter names are fine.',
    // Verbatim from a real run, and the reason this whole case exists. The
    // same report was filed three times: two analyses carried a "Behaviour
    // change:" section and went to a person, this one came back as a terse
    // past-tense summary, extraction recorded "no behaviour change", and a
    // coding agent was sent at it unattended.
    analysisText:
      'Fixed sidebar project name overflow in `service-rail.tsx`: parent container now ' +
      '`max-w-full overflow-hidden`, name span now `block w-full max-w-full truncate` so long names ' +
      'ellipsis instead of overlapping gear. `tsc --noEmit` clean, no existing rail tests found.',
    expected: 'needs-human',
    exercises: 'a report of work already done, which clears none of the gates',
    expectedAnalysis: {
      summary: 'A summary of a change already made to the sidebar rail, not an analysis of the report.',
      filesTouched: ['service-rail.tsx'],
      // It does state a visible difference, so this one is answerable, and the
      // two analyses of the same report that were written as analyses both
      // called it a behaviour change. Reading the same fact differently
      // because the prose is shaped differently is the bug this case holds.
      changesBehaviour: 'yes',
      // Dependencies it never touches: no sentence mentions a package, so
      // answering "no" is inventing a clearance nobody gave. Intent it does
      // settle, since "Fixed ... overflow" characterises the old state as a
      // fault.
      needsNewDependency: 'unknown',
      looksIntentional: 'no',
      confidence: 0.3,
    },
    docsConfidence: 0.372,
  },
  {
    id: 'silent-on-consequences',
    title: 'Deleted services still appear in the project switcher',
    body: 'I deleted a service two days ago and it is still listed in the switcher dropdown until I hard refresh.',
    // Names a file and a cause, then stops. Nothing here rules out a
    // behaviour change or a new dependency, and nothing calls it a defect.
    analysisText:
      'The switcher reads from a cached project payload in state/project-cache.ts. The cache is ' +
      'populated on login and has no invalidation hook for service deletion.',
    expected: 'needs-human',
    exercises: 'an analysis that finds the cause and never discusses the fix',
    expectedAnalysis: {
      summary: 'The project switcher reads a cache that is never invalidated when a service is deleted.',
      filesTouched: ['state/project-cache.ts'],
      // It finds the cause and stops: nothing about what the fix would change
      // for a user, nothing about packages. "No invalidation hook" does
      // characterise the current behaviour as a missing guard, so intent is
      // settled even though the other two are not.
      changesBehaviour: 'unknown',
      needsNewDependency: 'unknown',
      looksIntentional: 'no',
      confidence: 0.55,
    },
    docsConfidence: 0.3,
  },
]

/**
 * The hand-written cases plus everything promoted out of the decision log.
 * A promoted case is a first-class member from the moment it lands.
 */
export const DATASET: EvalCase[] = [...BASE_DATASET, ...promotedEvalCases()]

export const CASES_BY_ID = new Map(DATASET.map((c) => [c.id, c]))

/** The hand-written ids, so promotion can avoid colliding with them. */
export const BASE_IDS = BASE_DATASET.map((c) => c.id)
