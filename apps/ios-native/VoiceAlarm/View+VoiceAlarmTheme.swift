import SwiftUI

/// SwiftUI helpers that translate the most common Compose component styles
/// from `apps/android-native/.../ui/components/VocaWakeDesign.kt` into
/// reusable view modifiers. Call sites mirror the Android API surface:
///
/// - `.vocaCardSurface()`  ↔ `Surface(shape = VocaWakeCardShape, ...)`
/// - `.vocaButtonPrimary()` ↔ `Button(colors = ButtonDefaults.buttonColors())`
/// - `.vocaButtonSecondary()` ↔ `OutlinedButton(colors = vocaWakeOutlinedButtonColors())`
/// - `.vocaChip()`         ↔ `AssistChip` with capsule shape
/// - `.vocaSectionHeader()` ↔ Compose section header pattern used inside
///   `VoiceStudioScreen` and friends.
extension View {
    /// Card surface — filled `surface` background, rounded with `vocaCard`
    /// corner radius, hairline outline using `outlineVariant`, plus an `sm`
    /// elevation shadow.
    func vocaCardSurface() -> some View {
        modifier(VocaCardSurfaceModifier())
    }

    /// Primary filled button — `primary` background and `onPrimary` label.
    func vocaButtonPrimary() -> some View {
        modifier(VocaButtonPrimaryModifier())
    }

    /// Secondary outlined button — transparent background, `outline` border,
    /// `onSurface` label.
    func vocaButtonSecondary() -> some View {
        modifier(VocaButtonSecondaryModifier())
    }

    /// Chip / pill — capsule shape, `surfaceVariant` background, `onSurface`
    /// label. Pass `selected: true` for the filled (primary) variant.
    func vocaChip(selected: Bool = false) -> some View {
        modifier(VocaChipModifier(selected: selected))
    }

    /// Section header text style used at the top of grouped lists.
    func vocaSectionHeader() -> some View {
        modifier(VocaSectionHeaderModifier())
    }
}

// MARK: - Modifiers

private struct VocaCardSurfaceModifier: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    func body(content: Content) -> some View {
        content
            .padding(theme.spacing.md)
            .background(
                RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                    .fill(theme.palette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                    .stroke(theme.palette.outlineVariant, lineWidth: 1)
            )
            .vocaElevation(theme.elevation.sm)
    }
}

private struct VocaButtonPrimaryModifier: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    func body(content: Content) -> some View {
        content
            .font(theme.typography.labelLarge)
            .foregroundStyle(theme.palette.onPrimary)
            .padding(.vertical, theme.spacing.sm)
            .padding(.horizontal, theme.spacing.lg)
            .frame(minHeight: 44)
            .background(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .fill(theme.palette.primary)
            )
    }
}

private struct VocaButtonSecondaryModifier: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    func body(content: Content) -> some View {
        content
            .font(theme.typography.labelLarge)
            .foregroundStyle(theme.palette.onSurface)
            .padding(.vertical, theme.spacing.sm)
            .padding(.horizontal, theme.spacing.lg)
            .frame(minHeight: 44)
            .background(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .fill(Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
                    .stroke(theme.palette.outline, lineWidth: 1)
            )
    }
}

private struct VocaChipModifier: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme
    let selected: Bool

    func body(content: Content) -> some View {
        let background = selected ? theme.palette.primary : theme.palette.surfaceVariant
        let foreground = selected ? theme.palette.onPrimary : theme.palette.onSurface

        content
            .font(theme.typography.labelMedium)
            .foregroundStyle(foreground)
            .padding(.vertical, theme.spacing.xs)
            .padding(.horizontal, theme.spacing.sm)
            .background(Capsule().fill(background))
    }
}

private struct VocaSectionHeaderModifier: ViewModifier {
    @Environment(\.voiceAlarmTheme) private var theme

    func body(content: Content) -> some View {
        content
            .font(theme.typography.titleMedium)
            .foregroundStyle(theme.palette.onSurfaceVariant)
            .padding(.vertical, theme.spacing.xs)
    }
}
