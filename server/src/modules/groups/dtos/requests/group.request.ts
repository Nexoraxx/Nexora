import { z } from 'zod'

// Zalo PC "Tạo nhóm": at least 2 others ("Tạo nhóm từ 3 người trở lên"); an empty name gets the members' names
export const CreateGroupRequest = z.object({
  name: z.string().default(''),
  members: z.array(z.string().min(1)).min(2, 'Tạo nhóm từ 3 người trở lên'),
})
export type CreateGroupRequest = z.infer<typeof CreateGroupRequest>

export const MembersRequest = z.object({ userIds: z.array(z.string().min(1)).min(1) })

export const InviteToGroupsRequest = z.object({ groupIds: z.array(z.string().min(1)).min(1) })

// "Rời nhóm trong im lặng"; an owner may pick the new owner first ("Chọn trưởng nhóm mới trước khi rời")
export const LeaveGroupRequest = z.object({ silent: z.boolean().default(false), newOwnerId: z.string().min(1).optional() })
export type LeaveGroupRequest = z.infer<typeof LeaveGroupRequest>

export const ReviewRequest = z.object({ userIds: z.array(z.string().min(1)).min(1), approve: z.boolean() })

export const OwnerRequest = z.object({ userId: z.string().min(1) })

export const LinkRequest = z.object({ link: z.string().trim().min(1, 'Vui lòng nhập link') })

export const DeclineInvitationRequest = z.object({ block: z.stringbool().default(false) })

// the switches of PC's "Quản lý nhóm"; 1 = on
const Flag = z.union([z.literal(0), z.literal(1)]).optional()
export const GroupSettingsRequest = z.object({
  blockName: Flag,
  setTopicOnly: Flag,
  lockCreatePost: Flag,
  lockCreatePoll: Flag,
  lockSendMsg: Flag,
  lockViewMember: Flag,
  joinAppr: Flag,
  signAdminMsg: Flag,
  enableMsgHistory: Flag,
})
export type GroupSettingsRequest = z.infer<typeof GroupSettingsRequest>
