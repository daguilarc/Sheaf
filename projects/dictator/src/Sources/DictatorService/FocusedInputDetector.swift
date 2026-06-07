import ApplicationServices
import Foundation

enum FocusedInputDetector {
    private static let axEditableAttribute = "AXEditable" as CFString
    private static let axSearchFieldRole = "AXSearchField"
    private static let maxParentHops = 8

    struct Assessment {
        let isTextInputFocused: Bool
        let summary: String
    }

    static func isTextInputFocused() -> Bool {
        assessFocusedInput().isTextInputFocused
    }

    static func assessFocusedInput() -> Assessment {
        guard AXIsProcessTrusted() else {
            return Assessment(isTextInputFocused: false, summary: "AX not trusted")
        }

        let systemWide = AXUIElementCreateSystemWide()
        var focusedObject: CFTypeRef?
        let focusedStatus = AXUIElementCopyAttributeValue(
            systemWide,
            kAXFocusedUIElementAttribute as CFString,
            &focusedObject
        )
        guard focusedStatus == .success, let focusedObject else {
            return Assessment(isTextInputFocused: false, summary: "No focused AX element (status=\(focusedStatus.rawValue))")
        }
        let focusedElement = focusedObject as! AXUIElement

        var current: AXUIElement? = focusedElement
        var hop = 0
        var traceParts: [String] = []
        while let element = current, hop <= maxParentHops {
            let role = copyStringAttribute(kAXRoleAttribute as CFString, from: element) ?? "<unknown>"
            let editable = copyBoolAttribute(axEditableAttribute, from: element)
            let valueSettable = isAttributeSettable(kAXValueAttribute as CFString, on: element)
            let selectionSettable = isAttributeSettable(kAXSelectedTextRangeAttribute as CFString, on: element)
            traceParts.append(
                "hop=\(hop) role=\(role) editable=\(editable.map(String.init) ?? "nil") valueSettable=\(valueSettable) selectionSettable=\(selectionSettable)"
            )
            if isTextInputRole(role: role, editableAttribute: editable)
                || valueSettable
                || selectionSettable {
                return Assessment(
                    isTextInputFocused: true,
                    summary: traceParts.joined(separator: " | ")
                )
            }
            current = copyElementAttribute(kAXParentAttribute as CFString, from: element)
            hop += 1
        }

        return Assessment(
            isTextInputFocused: false,
            summary: traceParts.joined(separator: " | ")
        )
    }

    static func isTextInputRole(role: String?, editableAttribute: Bool?) -> Bool {
        if editableAttribute == true {
            return true
        }

        guard let role else {
            return false
        }

        return role == kAXTextFieldRole as String
            || role == kAXTextAreaRole as String
            || role == axSearchFieldRole
            || role == kAXComboBoxRole as String
    }

    private static func copyElementAttribute(_ attribute: CFString, from element: AXUIElement) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else {
            return nil
        }
        guard let value else {
            return nil
        }
        return (value as! AXUIElement)
    }

    private static func copyStringAttribute(_ attribute: CFString, from element: AXUIElement) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else {
            return nil
        }
        return value as? String
    }

    private static func copyBoolAttribute(_ attribute: CFString, from element: AXUIElement) -> Bool? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else {
            return nil
        }
        return value as? Bool
    }

    private static func isAttributeSettable(_ attribute: CFString, on element: AXUIElement) -> Bool {
        var settable: DarwinBoolean = false
        let status = AXUIElementIsAttributeSettable(element, attribute, &settable)
        return status == .success && settable.boolValue
    }
}
