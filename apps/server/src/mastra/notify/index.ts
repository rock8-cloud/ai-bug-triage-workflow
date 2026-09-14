/**
 * Which notifier this process runs with, decided once from the environment.
 *
 * The Chat SDK instance belongs to the review agent and exists only after
 * Mastra has initialised it, so the Slack notifier is handed a getter rather
 * than the instance.
 */
import { PinoLogger } from '@mastra/loggers'
import { SLACK_CHANNEL_ID, SLACK_ENABLED } from '../../config'
import { NoopNotifier, type Notifier } from './notifier'
import { SlackNotifier } from './slack-notifier'
import { reviewChannel } from '../agents/review-agent'

export const notifier: Notifier = SLACK_ENABLED
  ? new SlackNotifier(() => reviewChannel(), SLACK_CHANNEL_ID, new PinoLogger({ name: 'slack', level: 'info' }))
  : new NoopNotifier()
