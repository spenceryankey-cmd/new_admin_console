import { BadRequestException, type PipeTransform } from '@nestjs/common'
import type { ZodTypeAny, z } from 'zod'

export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      const first = result.error.issues[0]
      throw new BadRequestException({
        message: first?.message ?? 'Invalid request',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    return result.data
  }
}
