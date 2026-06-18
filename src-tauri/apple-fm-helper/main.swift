// Apple Foundation Models helper for Glassbox's on-device AI provider (doc 22).
//
// The Node server can't call Apple's native `FoundationModels` framework, so it
// shells out to this tiny Swift CLI (see `src/ai/apple-foundation.ts`). Because
// the *server* runs it, all analysis modes (risk / narrative / guided) work with
// no per-mode change.
//
// Protocol:
//   apple-fm-helper --probe    → prints "available" or "unavailable" (exit 0)
//   apple-fm-helper --infer     → reads {"system","messages":[{"role","content"}]}
//                                 JSON on stdin, writes {"content":"…"} JSON on
//                                 stdout (exit 0)
//
// Unlike a fixed-schema task, Glassbox uses three different JSON shapes
// (risk / narrative / guided) and the system prompt already instructs the model
// to emit JSON-only output, so this runs a plain text generation and returns the
// raw text — the server's `extractJSON` parses it exactly as it does the cloud
// providers' responses. (Guided generation with `@Generable` could be added per
// analysis type later if on-device JSON adherence proves weak.)
//
// Requires macOS 26+ with Apple Intelligence (FoundationModels). Build + sign via
// scripts/build-apple-fm-helper.sh; bundle it with the app and point the server
// at it with GLASSBOX_APPLE_FM_BIN (docs/tauri-architecture.md). NOT compiled by
// cargo — it's a standalone executable.
import Foundation
import FoundationModels

// MARK: - Wire types (stdin in / stdout out)

struct WireMessage: Decodable {
    let role: String
    let content: String
}

struct InferInput: Decodable {
    let system: String
    let messages: [WireMessage]
}

struct InferOutput: Encodable {
    let content: String
}

private func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

/// Print on-device model availability and exit.
private func probe() -> Never {
    switch SystemLanguageModel.default.availability {
    case .available:
        print("available")
    default:
        print("unavailable")
    }
    exit(0)
}

/// Flatten the chat messages into a single prompt. The helper spawns fresh per
/// call (stateless), so any multi-turn `needContext` round is replayed here as
/// labeled turns; the system prompt is passed as the session's instructions.
private func buildPrompt(_ messages: [WireMessage]) -> String {
    messages.map { msg in
        let label = msg.role == "assistant" ? "Assistant" : "User"
        return "\(label): \(msg.content)"
    }.joined(separator: "\n\n")
}

/// Read {system, messages} from stdin, run one on-device generation, print
/// `{content:"…"}` JSON to stdout.
private func infer() async -> Never {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard let input = try? JSONDecoder().decode(InferInput.self, from: data) else {
        fail("invalid input: expected {\"system\",\"messages\"} JSON on stdin", code: 2)
    }
    guard case .available = SystemLanguageModel.default.availability else {
        fail("Apple Foundation Models unavailable", code: 3)
    }
    do {
        let session = LanguageModelSession(instructions: input.system)
        let response = try await session.respond(to: buildPrompt(input.messages))
        let out = InferOutput(content: response.content)
        let json = try JSONEncoder().encode(out)
        print(String(decoding: json, as: UTF8.self))
        exit(0)
    } catch {
        fail("inference failed: \(error)", code: 4)
    }
}

let args = CommandLine.arguments
if args.contains("--probe") {
    probe()
} else if args.contains("--infer") {
    // Run the async work, then park the main thread; `infer()` calls exit() when
    // done, which terminates the process.
    Task { await infer() }
    dispatchMain()
} else {
    fail("usage: apple-fm-helper --probe | --infer", code: 64)
}
