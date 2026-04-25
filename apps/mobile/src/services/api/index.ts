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
  registerPushToken,
  unregisterPushToken,
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
  deleteAccount,
  getStats,
  getActivity,
  searchUsers,
  getLibrary,
  toggleFavorite,
  deleteLibraryItem,
} from './user';
export type { WeekTrend, Stats, ActivityItem, UserSearchResult } from './user';

export {
  getVouchers,
  registerCode,
} from './billing';
export type {
  VoucherItem,
  CodeRegisterVoucherResult,
  CodeRegisterInviteResult,
  CodeRegisterResult,
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
