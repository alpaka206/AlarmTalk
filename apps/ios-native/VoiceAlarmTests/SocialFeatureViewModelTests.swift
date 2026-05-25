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
}
