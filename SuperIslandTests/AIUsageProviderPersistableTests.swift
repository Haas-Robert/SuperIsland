import XCTest
@testable import SuperIsland

/// The last good Claude payload is persisted through JSONSerialization;
/// a single non-JSON value anywhere in it makes `persistClaudePayload`
/// drop the whole payload silently. Build it from a response shaped like
/// the real endpoint (nulls, nested scopes, spend caps) and check every
/// leaf, naming the offending path on failure.
final class AIUsageProviderPersistableTests: XCTestCase {

    private func realisticResponse(fiveHourOpen: Bool) -> [String: Any] {
        var response: [String: Any] = [
            "five_hour": fiveHourOpen
                ? ["utilization": 9.0, "resets_at": "2026-11-20T22:39:00+00:00", "limit_dollars": NSNull()]
                : NSNull(),
            "seven_day": ["utilization": 15.0, "resets_at": "2026-11-21T08:00:00+00:00",
                          "limit_dollars": NSNull(), "used_dollars": NSNull(), "locked_reason": NSNull()],
            "seven_day_opus": NSNull(),
            "seven_day_sonnet": NSNull(),
            "limits": [
                ["kind": "weekly_all", "group": "weekly", "percent": 15, "severity": "normal",
                 "resets_at": "2026-11-21T08:00:00+00:00", "scope": NSNull(), "is_active": false],
                ["kind": "weekly_scoped", "group": "weekly", "percent": 27, "severity": "normal",
                 "resets_at": "2026-11-21T08:00:00+00:00",
                 "scope": ["model": ["display_name": "Fable"]], "is_active": true]
            ],
            "extra_usage": ["is_enabled": true, "monthly_limit": 50, "used_credits": 2.4, "utilization": 4.8,
                            "currency": "USD", "decimal_places": 2, "daily": NSNull(), "weekly": NSNull()],
            "spend": [
                "enabled": true,
                "used": ["amount_minor": 240, "currency": "USD", "exponent": 2],
                "limit": ["amount_minor": 5000, "currency": "USD", "exponent": 2],
                "percent": 4.8, "severity": "normal",
                "cap": ["money": ["amount_minor": 5000, "currency": "USD", "exponent": 2], "credits": NSNull()],
                "balance": NSNull(), "auto_reload": NSNull()
            ],
            "seven_day_breakdown": ["as_of": "2026-11-20T09:47:57+00:00",
                                    "rows": [["key": "fable", "display_name": "Fable", "percent": 27, "percent_of_limit": 100]]],
            "amber_cistern": NSNull(),
            "member_dashboard_available": true
        ]
        response["pace"] = NSNull()
        return response
    }

    /// Returns the key path of the first value JSONSerialization rejects.
    private func firstInvalidPath(_ value: Any, path: String = "$") -> String? {
        switch value {
        case let dictionary as [String: Any]:
            for (key, nested) in dictionary {
                if let bad = firstInvalidPath(nested, path: "\(path).\(key)") { return bad }
            }
            return nil
        case let array as [Any]:
            for (index, nested) in array.enumerated() {
                if let bad = firstInvalidPath(nested, path: "\(path)[\(index)]") { return bad }
            }
            return nil
        case is String, is NSNull, is Bool:
            return nil
        case let number as NSNumber:
            return number.doubleValue.isFinite ? nil : "\(path) (non-finite number)"
        default:
            return "\(path) (\(type(of: value)))"
        }
    }

    func test_payload_from_a_full_response_is_valid_json_leaf_by_leaf() throws {
        let payload = try XCTUnwrap(AIUsageProvider.claudeOAuthResponsePayload(from: realisticResponse(fiveHourOpen: true), updatedAt: 1))
        XCTAssertNil(firstInvalidPath(payload))
        XCTAssertTrue(JSONSerialization.isValidJSONObject(payload))
    }

    func test_payload_from_a_weekly_only_response_with_limits_is_valid_json() throws {
        let payload = try XCTUnwrap(AIUsageProvider.claudeOAuthResponsePayload(from: realisticResponse(fiveHourOpen: false), updatedAt: 1))
        XCTAssertNil(firstInvalidPath(payload))
        XCTAssertTrue(JSONSerialization.isValidJSONObject(payload))
        XCTAssertEqual((payload["limits"] as? [[String: Any]])?.count, 2)
    }
}
