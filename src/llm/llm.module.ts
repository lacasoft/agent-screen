import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_CLIENT } from './llm.constants';
import { OpenRouterClient } from './openrouter.client';

@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OpenRouterClient({
          apiKey: config.getOrThrow<string>('OPENROUTER_API_KEY'),
          model: config.getOrThrow<string>('LLM_MODEL'),
          fallbackModels: (config.get<string>('LLM_FALLBACK_MODELS') ?? '')
            .split(',')
            .map((m) => m.trim())
            .filter(Boolean),
        }),
    },
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}
