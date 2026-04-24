import type { Friend, PendingFriendRequest, Gift } from '../../types';
import { get, post, patch, del, request } from './core';

// ===== Friend API =====

export async function sendFriendRequest(email: string) {
  const data = await post<{ friendship: Friend }>('/friend', { email });
  return data.friendship;
}

export async function getFriendList() {
  const data = await get<{ friends: Friend[] }>('/friend/list');
  return data.friends;
}

export async function getPendingRequests() {
  const data = await get<{ pending: PendingFriendRequest[] }>('/friend/pending');
  return data.pending;
}

export async function acceptFriendRequest(id: string) {
  await patch(`/friend/${id}/accept`);
}

export async function deleteFriend(id: string) {
  await del(`/friend/${id}`);
}

// ===== Gift API =====

export async function sendGift(params: {
  recipient_email: string;
  message_id: string;
  note?: string;
}) {
  const data = await post<{ gift: Gift }>('/gift', params);
  return data.gift;
}

export async function getReceivedGifts() {
  const data = await get<{ gifts: Gift[] }>('/gift/received');
  return data.gifts;
}

export async function getSentGifts() {
  const data = await get<{ gifts: Gift[] }>('/gift/sent');
  return data.gifts;
}

export async function acceptGift(id: string) {
  await patch(`/gift/${id}/accept`);
}

export async function rejectGift(id: string) {
  await patch(`/gift/${id}/reject`);
}

// ===== Notes API =====

export interface ReceivedNote {
  id: string;
  sender_id: string;
  sender_name: string | null;
  sender_email: string;
  sender_picture: string | null;
  text: string;
  audio_url: string | null;
  read_at: string | null;
  created_at: string;
}

export interface SentNote {
  id: string;
  receiver_id: string;
  receiver_name: string | null;
  receiver_email: string;
  text: string;
  audio_url: string | null;
  read_at: string | null;
  created_at: string;
}

export async function sendNote(receiverId: string, text: string) {
  return post<{ success: boolean; note: ReceivedNote }>('/notes', {
    receiver_id: receiverId,
    text,
  });
}

export async function getReceivedNotes(limit = 20, offset = 0) {
  const data = await get<{ notes: ReceivedNote[] }>(
    `/notes/received?limit=${limit}&offset=${offset}`,
  );
  return data.notes;
}

export async function getSentNotes(limit = 20, offset = 0) {
  const data = await get<{ notes: SentNote[] }>(
    `/notes/sent?limit=${limit}&offset=${offset}`,
  );
  return data.notes;
}

export async function markNoteRead(noteId: string) {
  return request<{ success: boolean; read_at?: string }>({
    method: 'PATCH',
    path: `/notes/${noteId}/read`,
  });
}
