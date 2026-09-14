import { registerApiRoute } from '@mastra/core/server'
import { forgetDecision, listStandingDecisions } from '../store/standing'

/**
 * Standing decisions, and the ability to take one back.
 *
 * Forgetting has to be as easy as remembering. A rule that silently closes
 * reports is only safe if someone can see the whole list and delete anything
 * that has started catching the wrong things.
 */
export const standingRoutes = [
  registerApiRoute('/standing', {
    method: 'GET',
    handler: async (c) => c.json({ decisions: await listStandingDecisions() }),
  }),

  registerApiRoute('/standing/:id', {
    method: 'DELETE',
    handler: async (c) => {
      const id = c.req.param('id')
      if (!id) return c.json({ error: 'An id is required.' }, 400)
      await forgetDecision(id)
      return c.json({ ok: true })
    },
  }),
]
