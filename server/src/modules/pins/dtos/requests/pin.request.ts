import { z } from 'zod'

const TopicRef = z.object({ topicId: z.string().min(1), topicType: z.number().int() })

// replace: the pin to drop first when the list is full
export const PinRequest = z.object({ msgId: z.string().min(1), replace: TopicRef.optional() })
export type PinRequest = z.infer<typeof PinRequest>

export const UnpinRequest = TopicRef
export type UnpinRequest = z.infer<typeof UnpinRequest>
