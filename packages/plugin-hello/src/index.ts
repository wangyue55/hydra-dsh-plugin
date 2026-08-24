import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'hydra-hello'
export const inject = ['tools']

export interface Config {
  greeting: string
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
})

/**
 * Register the `hydra_greet` tool: greets a name with the configured greeting.
 * @param ctx - plugin context; `tools` is ready when this runs.
 * @param config - validated configuration from the profile's composed layers.
 */
export function apply(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: 'hydra_greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `${config.greeting}, ${args.name}!`
    },
  }))
}
