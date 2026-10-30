export default interface IConversationRepository {
  lastMessage(accountId: string, threadId: string): { cliMsgId: string | null; fromUid: string } | null
}
