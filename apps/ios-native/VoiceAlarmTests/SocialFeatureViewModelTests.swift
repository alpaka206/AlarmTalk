import XCTest
@testable import VoiceAlarm

@MainActor
final class SocialFeatureViewModelTests: XCTestCase {
    func test_normalizedMessageReceiverID_keepsTrimmedSelectedWhenStillAvailable() {
        let members = [
            member(userId: "me", email: "me@example.com"),
            member(userId: "other-1", email: "one@example.com"),
            member(userId: "other-2", email: "two@example.com"),
        ]

        let receiverID = SocialFeatureViewModel.normalizedMessageReceiverID(
            selected: " other-2 ",
            members: members,
            currentUserID: "me",
            currentUserEmail: "me@example.com"
        )

        XCTAssertEqual(receiverID, "other-2")
    }

    func test_normalizedMessageReceiverID_replacesStaleSelectedWithFirstRecipient() {
        let members = [
            member(userId: "me", email: "me@example.com"),
            member(userId: "other-1", email: "one@example.com"),
            member(userId: "other-2", email: "two@example.com"),
        ]

        let receiverID = SocialFeatureViewModel.normalizedMessageReceiverID(
            selected: "removed-user",
            members: members,
            currentUserID: "me",
            currentUserEmail: "me@example.com"
        )

        XCTAssertEqual(receiverID, "other-1")
    }

    func test_normalizedMessageReceiverID_excludesCurrentUserByIDAndEmail() {
        let members = [
            member(userId: "legacy-self", email: "me@example.com"),
            member(userId: "me", email: "other-self@example.com"),
            member(userId: "other-1", email: "one@example.com"),
        ]

        let receiverID = SocialFeatureViewModel.normalizedMessageReceiverID(
            selected: nil,
            members: members,
            currentUserID: "me",
            currentUserEmail: "me@example.com"
        )

        XCTAssertEqual(receiverID, "other-1")
    }

    func test_receivedNoteRefreshStateDropsUnavailablePlayingAudioLikeAndroidRefresh() {
        let notes = [
            note(id: "audio-missing", audioUrl: "r2://missing", audioAvailable: false),
            note(id: "text-only", audioUrl: nil, audioAvailable: nil),
            note(id: "audio-ready", audioUrl: "r2://ready", audioAvailable: true),
        ]

        let state = SocialFeatureViewModel.receivedNoteRefreshState(
            notes: notes,
            unavailableAudioNoteIDs: ["audio-missing", "audio-ready", "stale"],
            revealedNoteIDs: ["audio-missing", "text-only", "stale"],
            playingNoteID: "audio-missing"
        )

        XCTAssertEqual(state.notes, notes)
        XCTAssertEqual(state.unavailableAudioNoteIDs, ["audio-missing"])
        XCTAssertEqual(state.revealedNoteIDs, ["audio-missing", "text-only"])
        XCTAssertNil(state.playingNoteID)
    }

    func test_receivedNoteRefreshStateKeepsPlayableCurrentAudio() {
        let notes = [
            note(id: "audio-ready", audioUrl: "r2://ready", audioAvailable: true),
        ]

        let state = SocialFeatureViewModel.receivedNoteRefreshState(
            notes: notes,
            unavailableAudioNoteIDs: [],
            revealedNoteIDs: ["audio-ready"],
            playingNoteID: "audio-ready"
        )

        XCTAssertEqual(state.revealedNoteIDs, ["audio-ready"])
        XCTAssertEqual(state.playingNoteID, "audio-ready")
    }

    func test_socialNotificationPlanSkipsInitialRefreshLikeAndroid() {
        let notes = [
            note(id: "first", audioUrl: nil, audioAvailable: nil),
            note(id: "second", audioUrl: nil, audioAvailable: nil),
        ]

        let plan = SocialNotificationTracker.refreshPlan(
            notes: notes,
            seenNoteIDs: [],
            allowInitialNotify: false
        )

        XCTAssertEqual(plan.requests, [])
        XCTAssertEqual(plan.nextSeenNoteIDs, ["first", "second"])
    }

    func test_socialNotificationPlanNotifiesUnreadUnseenNotesLikeAndroid() {
        let notes = [
            note(id: "seen", senderName: "이미 본 사람", text: "old", readAt: nil),
            note(id: "read", senderName: "읽은 사람", text: "read", readAt: "2026-05-26T00:00:00Z"),
            note(id: "new-1", senderName: "김규원", text: "오늘 점심 맛있게 먹어", readAt: nil),
            note(id: "new-2", senderName: nil, senderEmail: nil, text: "", readAt: nil),
            note(id: "new-3", senderName: "세번째", text: "third", readAt: nil),
            note(id: "new-4", senderName: "네번째", text: "fourth", readAt: nil),
        ]

        let plan = SocialNotificationTracker.refreshPlan(
            notes: notes,
            seenNoteIDs: ["seen"],
            allowInitialNotify: false
        )

        XCTAssertEqual(plan.requests.map(\.noteID), ["new-1", "new-2", "new-3"])
        XCTAssertEqual(plan.requests[0].title, "김규원")
        XCTAssertEqual(plan.requests[0].body, "오늘 점심 맛있게 먹어")
        XCTAssertEqual(plan.requests[1].title, "새 메시지")
        XCTAssertEqual(plan.requests[1].body, "새 메시지가 도착했어요.")
        XCTAssertEqual(plan.nextSeenNoteIDs, ["seen", "read", "new-1", "new-2", "new-3", "new-4"])
    }

    func test_receivedAlarmNotificationRequestMatchesAndroidCopy() {
        let request = SocialNotificationTracker.receivedAlarmRequest(
            alarmID: "alarm-1",
            title: "김규원님이 보낸 알람",
            time: "07:30"
        )

        XCTAssertEqual(request.noteID, "alarm-1")
        XCTAssertEqual(request.title, "김규원님이 보낸 알람")
        XCTAssertEqual(request.body, "07:30에 울려요.")
    }

    private func member(userId: String, email: String?) -> FamilyGroupMember {
        FamilyGroupMember(
            id: userId,
            userId: userId,
            role: userId == "me" ? "owner" : "member",
            joinedAt: "2026-05-20T00:00:00Z",
            email: email,
            name: nil,
            allowFamilyAlarms: nil,
            familyAlarmQuietDays: nil,
            familyAlarmQuietStart: nil,
            familyAlarmQuietEnd: nil,
            familyAlarmQuietWindows: nil,
            dynamicPromptSettings: nil,
            dynamicPromptSettingsState: nil
        )
    }

    private func note(
        id: String,
        audioUrl: String?,
        audioAvailable: Bool?
    ) -> ReceivedNote {
        note(
            id: id,
            senderName: "sender",
            senderEmail: "sender@example.com",
            text: "message",
            audioUrl: audioUrl,
            audioAvailable: audioAvailable,
            readAt: nil
        )
    }

    private func note(
        id: String,
        senderName: String?,
        senderEmail: String? = "sender@example.com",
        text: String,
        audioUrl: String? = nil,
        audioAvailable: Bool? = nil,
        readAt: String?
    ) -> ReceivedNote {
        ReceivedNote(
            id: id,
            senderId: "sender",
            senderName: senderName,
            senderEmail: senderEmail,
            senderPicture: nil,
            text: text,
            audioUrl: audioUrl,
            audioAvailable: audioAvailable,
            readAt: readAt,
            createdAt: "2026-05-26T00:00:00Z"
        )
    }
}
