import Foundation
import EventKit

let store = EKEventStore()
func emit(_ value: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) { print(text) }
}
func status() -> String {
    let value = EKEventStore.authorizationStatus(for: .event)
    if value == .restricted { return "restricted" }
    if value == .denied { return "denied" }
    if value == .notDetermined { return "notDetermined" }
    if #available(macOS 14.0, *) { return value == .fullAccess ? "authorized" : "denied" }
    return value == .authorized ? "authorized" : "denied"
}
let command = CommandLine.arguments.dropFirst().first ?? "status"
if command == "status" { emit(["authorization": status()]) }
else if command == "connect" {
    let completed = DispatchSemaphore(value: 0)
    let callback: (Bool, Error?) -> Void = { _, _ in completed.signal() }
    if #available(macOS 14.0, *) { store.requestFullAccessToEvents(completion: callback) }
    else { store.requestAccess(to: .event, completion: callback) }
    let deadline = Date().addingTimeInterval(120)
    while completed.wait(timeout: .now()) != .success && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
    emit(["authorization": status()])
} else if command == "events" {
    guard status() == "authorized" else { emit(["authorization": status(), "items": []]); exit(0) }
    let args = Array(CommandLine.arguments.dropFirst(2))
    let start = Date(timeIntervalSince1970: (Double(args.first ?? "") ?? Date().timeIntervalSince1970 * 1000) / 1000)
    let end = Date(timeIntervalSince1970: (Double(args.dropFirst().first ?? "") ?? Date().addingTimeInterval(366 * 86400).timeIntervalSince1970 * 1000) / 1000)
    let calendars = store.calendars(for: .event)
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    let items: [[String: Any]] = store.events(matching: predicate).prefix(10000).map { event in
        ["id": event.eventIdentifier ?? UUID().uuidString, "uid": event.calendarItemIdentifier, "title": event.title ?? "", "description": event.notes ?? "", "location": event.location ?? "", "start": event.startDate.timeIntervalSince1970 * 1000, "end": event.endDate.timeIntervalSince1970 * 1000, "calendarId": event.calendar.calendarIdentifier, "calendarTitle": event.calendar.title, "source": "system"]
    }
    emit(["authorization": status(), "items": items])
} else { emit(["error": "unsupported command"]); exit(1) }
