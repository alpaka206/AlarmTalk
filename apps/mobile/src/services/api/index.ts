export { ApiError } from './core';

export {
  getVoiceProfiles,
  getVoiceProfile,
  createVoiceClone,
  diarizeAudio,
  deleteVoiceProfile,
  getFamilyVoiceProfiles,
  updateVoiceProfile,
  uploadVoiceAudio,
  separateUpload,
  listSpeakers,
  renameSpeaker,
  generateTTS,
  getMessages,
  getMessagesByVoice,
  getPresets,
  deleteTtsMessage,
  getDubLanguages,
  startDub,
  getDubStatus,
  getDubJobs,
} from './voice';
export type {
  FamilyVoiceProfile,
  VoiceUploadMeta,
  SpeakerSegment,
} from './voice';

export {
  getAlarms,
  getAlarm,
  createAlarm,
  updateAlarm,
  deleteAlarm,
  uploadAlarmSource,
} from './alarm';

export {
  sendFriendRequest,
  getFriendList,
  getPendingRequests,
  acceptFriendRequest,
  deleteFriend,
  sendGift,
  getReceivedGifts,
  getSentGifts,
  acceptGift,
  rejectGift,
  sendNote,
  getReceivedNotes,
  getSentNotes,
  markNoteRead,
} from './social';
export type { ReceivedNote, SentNote } from './social';

export {
  getUserProfile,
  updatePlan,
  updateUserSettings,
  deleteAccount,
  getStats,
  getActivity,
  searchUsers,
  getLibrary,
  toggleFavorite,
  deleteLibraryItem,
} from './user';
export type { UserProfile, WeekTrend, Stats, ActivityItem, UserSearchResult } from './user';

export {
  getVouchers,
  registerCode,
  getSubscription,
  checkout,
} from './billing';
export type {
  VoucherItem,
  CodeRegisterVoucherResult,
  CodeRegisterInviteResult,
  CodeRegisterResult,
  SubscriptionPlan,
  Subscription,
  CheckoutResult,
} from './billing';

export {
  getFamilyGroupCurrent,
  createFamilyAlarmText,
  createFamilyInvite,
  getFamilyInvites,
  revokeFamilyInvite,
  leaveFamilyGroup,
  transferFamilyOwnership,
  removeFamilyMember,
} from './family';
export type {
  FamilyGroupMember,
  FamilyGroupCurrent,
  FamilyAlarmCreatePayload,
  FamilyAlarmCreateResponse,
  FamilyInvite,
} from './family';

export {
  getCharacterMe,
  grantCharacterXp,
} from './character';
export type {
  CharacterStage,
  XpEvent,
  CharacterPayload,
  CharacterProgress,
  CharacterStreak,
  CharacterStats,
  StreakAchievement,
  CharacterResponse,
  CharacterGrantResponse,
} from './character';
