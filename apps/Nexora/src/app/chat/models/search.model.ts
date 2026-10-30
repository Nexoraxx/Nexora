export type SearchContact = { userId: string; isGroup: boolean; name: string; avatar: string | null; isFr: boolean };
export type SearchMessage = {
  msgId: string;
  threadId: string;
  isGroup: boolean;
  threadName: string | null;
  threadAvatar: string | null;
  fromUid: string | null;
  dName: string | null;
  msgType: string;
  content: unknown;
  sendDttm: number;
};
