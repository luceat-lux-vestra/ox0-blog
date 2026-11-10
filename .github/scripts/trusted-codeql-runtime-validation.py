#!/usr/bin/env python3
"""Selective read-only CodeQL PR runtime compatibility contract for ox0-blog."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r"[0-9a-f]{40}\Z")
ACTION_LINE = re.compile(
    r"^\s*uses:\s*github/codeql-action/(?P<action>init|analyze)@"
    r"(?P<sha>[0-9a-f]{40})(?:\s+#.*)?\s*$"
)
SIMPLE_STATUSES = frozenset({"added", "modified", "removed"})
MOVE_STATUSES = frozenset({"renamed", "copied"})
RELEVANT_PATHS = frozenset({
    ".github/workflows/codeql.yml",
    ".github/workflows/validate.yml",
    ".github/workflows/repository-drift.yml",
    ".github/workflows/article-publication-lifecycle.yml",
    ".github/workflows/article-ghost.yml",
    ".github/repository-policy.json",
    ".github/scripts/trusted-codeql-runtime-validation.py",
    "scripts/check-repository-hardening.mjs",
    "test/ci-workflow-contract.test.mjs",
})


def reject(message: str) -> None:
    raise ValueError(message)


def safe_path(value: object) -> str:
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        reject(f"unsafe repository path: {value!r}")
    parts = PurePosixPath(value).parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        reject(f"unsafe repository path: {value!r}")
    return value


def flatten_pages(value: object) -> list[dict]:
    if not isinstance(value, list) or not value:
        reject("changed-file pagination is missing or empty")
    rows: list[dict] = []
    for page in value:
        if not isinstance(page, list):
            reject("changed-file pagination contains a non-list page")
        for row in page:
            if not isinstance(row, dict):
                reject("changed-file pagination contains a malformed record")
            rows.append(row)
    return rows


def validate_codeql_pin_only_patch(row: dict) -> None:
    if row.get("status") != "modified":
        reject("direct codeql.yml change is supported only as an in-place pin replacement")
    patch = row.get("patch")
    if not isinstance(patch, str) or not patch.strip():
        reject("direct codeql.yml change lacks a complete reviewable patch")

    changed: list[tuple[str, str, str]] = []
    for raw in patch.splitlines():
        if not raw or raw.startswith(("+++", "---", "@@")) or raw[0] not in "+-":
            continue
        match = ACTION_LINE.fullmatch(raw[1:])
        if match is None:
            reject("direct codeql.yml mutation is not an immutable init/analyze pin-only change")
        changed.append((raw[0], match.group("action"), match.group("sha")))

    if len(changed) != 4:
        reject("direct codeql.yml pin-only change must replace init and analyze exactly once")
    old = {action: sha for sign, action, sha in changed if sign == "-"}
    new = {action: sha for sign, action, sha in changed if sign == "+"}
    if set(old) != {"init", "analyze"} or set(new) != {"init", "analyze"}:
        reject("direct codeql.yml pin-only change must cover both init and analyze")
    if old["init"] != old["analyze"] or new["init"] != new["analyze"]:
        reject("CodeQL init/analyze pins must move together")
    if old["init"] == new["init"]:
        reject("CodeQL pin-only patch did not change the immutable pin")


def classify(
    pr: dict,
    pages: object,
    *,
    repo: str,
    base: str,
    head: str,
    head_repo: str,
) -> bool:
    if not SHA.fullmatch(base) or not SHA.fullmatch(head):
        reject("invalid immutable PR base/head identity")
    if not isinstance(repo, str) or "/" not in repo:
        reject("invalid base repository identity")
    if not isinstance(head_repo, str) or "/" not in head_repo:
        reject("invalid head repository identity")
    if not isinstance(pr, dict):
        reject("PR metadata is malformed")

    if pr.get("base", {}).get("sha") != base or pr.get("head", {}).get("sha") != head:
        reject("live PR base/head identity mismatch")
    if pr.get("base", {}).get("repo", {}).get("full_name") != repo:
        reject("live PR base repository mismatch")
    if pr.get("head", {}).get("repo", {}).get("full_name") != head_repo:
        reject("live PR head repository mismatch")

    count = pr.get("changed_files")
    if not isinstance(count, int) or count < 1 or count > 3000:
        reject("live PR changed-file count is missing or outside supported bounds")

    rows = flatten_pages(pages)
    if len(rows) != count:
        reject(f"changed-file pagination count mismatch: expected {count}, got {len(rows)}")

    seen: set[tuple[str, str, str | None]] = set()
    required = False
    for row in rows:
        status = row.get("status")
        if status not in SIMPLE_STATUSES | MOVE_STATUSES:
            reject(f"unsupported changed-file status: {status!r}")

        filename = safe_path(row.get("filename"))
        previous = row.get("previous_filename")
        if status in MOVE_STATUSES:
            previous = safe_path(previous)
        elif previous is not None:
            previous = safe_path(previous)

        key = (status, filename, previous)
        if key in seen:
            reject(f"duplicate changed-file record: {filename}")
        seen.add(key)

        touched = {filename}
        if previous:
            touched.add(previous)

        if ".github/workflows/codeql.yml" in touched:
            validate_codeql_pin_only_patch(row)
            required = True

        if touched & RELEVANT_PATHS:
            required = True

    return required


def action_pins(source: str) -> dict[str, str]:
    found: dict[str, list[str]] = {"init": [], "analyze": []}
    for match in re.finditer(
        r"github/codeql-action/(init|analyze)@([0-9a-f]{40})(?:\s+#.*)?",
        source,
    ):
        found[match.group(1)].append(match.group(2))
    if any(len(found[name]) != 1 for name in found):
        reject("expected exactly one CodeQL init and analyze invocation")
    return {name: values[0] for name, values in found.items()}


def job_block(source: str, job: str) -> str:
    match = re.search(
        rf"(?ms)^  {re.escape(job)}:\n(?P<body>.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)",
        source,
    )
    if match is None:
        reject(f"missing canonical PR job {job}")
    return match.group(0)


def check_contract(root: Path = ROOT) -> None:
    production_source = (root / ".github/workflows/codeql.yml").read_text(encoding="utf-8")
    validate_source = (root / ".github/workflows/validate.yml").read_text(encoding="utf-8")
    policy = json.loads((root / ".github/repository-policy.json").read_text(encoding="utf-8"))

    if re.search(r"(?m)^  (?:pull_request|pull_request_target|push):", production_source):
        reject("production CodeQL routine PR/push trigger reintroduced")
    for fragment in (
        "workflow_dispatch:",
        "schedule:",
        "- javascript-typescript",
        "- actions",
        "build-mode: none",
        "security-events: write",
        "remote_main=",
        "refs/heads/main",
        "persist-credentials: false",
    ):
        if fragment not in production_source:
            reject(f"production CodeQL contract missing {fragment!r}")

    production = action_pins(production_source)
    if production["init"] != production["analyze"]:
        reject("production CodeQL init/analyze pins diverged")

    runtime = job_block(validate_source, "codeql-runtime")
    for fragment in (
        "name: CodeQL Runtime",
        "timeout-minutes: 12",
        "contents: read",
        "pull-requests: read",
        "github.event.pull_request.head.repo.full_name",
        "github.event.pull_request.head.sha",
        "persist-credentials: false",
        "trusted-codeql-runtime-validation.py self-test",
        "trusted-codeql-runtime-validation.py check-contract",
        "languages: actions",
        "build-mode: none",
        'category: "/language:actions"',
        "upload: never",
        "runner.temp",
        "trusted-codeql-runtime-validation.py verify",
    ):
        if fragment not in runtime:
            reject(f"PR CodeQL runtime contract missing {fragment!r}")

    if re.search(r"(?m)^    if:", runtime):
        reject("PR CodeQL runtime must remain an always-present Merge Gate member")

    for forbidden in (
        "security-events: write",
        "actions: write",
        "id-token: write",
        "packages: write",
        "GHOST_ADMIN_API_KEY",
        "upload-artifact@",
        "upload: always",
    ):
        if forbidden in runtime:
            reject(f"PR CodeQL runtime contains forbidden authority {forbidden!r}")

    adapter = action_pins(runtime)
    if adapter["init"] != adapter["analyze"] or adapter["init"] != production["init"]:
        reject("PR CodeQL runtime pin does not match production init/analyze pin")

    for fragment in (
        "echo 'required=true'",
        "trusted-codeql-runtime-validation.py?ref=$BASE_SHA",
        "pulls/$PR_NUMBER",
        "files?per_page=100&page=$page",
        "--pr-json",
        "--files-json",
        "--head-repo",
    ):
        if fragment not in runtime:
            reject(f"trusted-base CodeQL classifier contract missing {fragment!r}")

    gate = job_block(validate_source, "merge-gate")
    if "needs: [validate, security, dependency-review, preview, codeql-runtime]" not in gate:
        reject("Merge Gate does not depend on the exact five direct members")
    if "const required = ['validate', 'security', 'dependency-review', 'codeql-runtime'];" not in gate:
        reject("Merge Gate required-member set does not include codeql-runtime")
    if "const expected = [...required, 'preview'].sort();" not in gate:
        reject("Merge Gate exact-member-set check drifted")

    if policy.get("main", {}).get("required_context_targets") != ["Merge Gate"]:
        reject("live merge authority must remain the sole Merge Gate context")
    runtime_policy = policy.get("security_analysis", {}).get("codeql_pr_runtime")
    if not isinstance(runtime_policy, dict):
        reject("repository policy lacks codeql_pr_runtime contract")
    if runtime_policy.get("workflow") != ".github/workflows/validate.yml":
        reject("repository policy CodeQL PR runtime workflow drifted")
    if runtime_policy.get("job") != "codeql-runtime":
        reject("repository policy CodeQL PR runtime job drifted")
    if runtime_policy.get("language") != "actions":
        reject("repository policy CodeQL PR runtime language drifted")
    if runtime_policy.get("production_evidence") is not False:
        reject("repository policy must mark PR runtime as non-production evidence")


def sarif_files(directory: Path) -> list[Path]:
    return sorted(path for path in directory.rglob("*.sarif") if path.is_file())


def rule_index(run: dict) -> dict[str, dict]:
    tool = run.get("tool", {})
    driver = tool.get("driver", {})
    entries = list(driver.get("rules", []) or [])
    for extension in tool.get("extensions", []) or []:
        entries.extend(extension.get("rules", []) or [])
    index: dict[str, dict] = {}
    for rule in entries:
        if isinstance(rule, dict) and isinstance(rule.get("id"), str):
            index[rule["id"]] = rule
    return index


def security_score(result: dict, rule: dict | None) -> float:
    candidates = []
    for props in (
        result.get("properties", {}),
        (rule or {}).get("properties", {}),
    ):
        if isinstance(props, dict):
            value = props.get("security-severity")
            if value is not None:
                candidates.append(value)
    for value in candidates:
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return 0.0


def verify_runtime(directory: Path, head: str, root: Path = ROOT) -> dict:
    if not SHA.fullmatch(head):
        reject("verify requires an exact immutable PR-head SHA")

    checkout = subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        text=True,
    ).strip()
    if checkout != head:
        reject(f"checked-out source {checkout} does not match expected PR head {head}")

    files = sarif_files(directory)
    if len(files) != 1:
        reject(f"expected exactly one SARIF file, found {len(files)}")

    try:
        document = json.loads(files[0].read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        reject(f"cannot parse local SARIF: {exc}")

    if document.get("version") != "2.1.0":
        reject("local SARIF version is not 2.1.0")
    runs = document.get("runs")
    if not isinstance(runs, list) or len(runs) != 1 or not isinstance(runs[0], dict):
        reject("local SARIF must contain exactly one run")
    run = runs[0]

    driver = run.get("tool", {}).get("driver", {})
    name = driver.get("name")
    if not isinstance(name, str) or "codeql" not in name.lower():
        reject("local SARIF is not identified as CodeQL output")

    automation = run.get("automationDetails", {})
    automation_id = automation.get("id", "") if isinstance(automation, dict) else ""
    if not isinstance(automation_id, str) or "language:actions" not in automation_id:
        reject(f"local SARIF Actions category is missing: {automation_id!r}")

    invocations = run.get("invocations")
    if not isinstance(invocations, list) or not invocations:
        reject("local SARIF lacks CodeQL invocation metadata")
    if any(
        not isinstance(invocation, dict) or invocation.get("executionSuccessful") is not True
        for invocation in invocations
    ):
        reject("local SARIF reports an unsuccessful CodeQL invocation")

    expected: set[str] = set()
    extracted: set[str] = set()
    for invocation in invocations:
        for bucket in ("toolExecutionNotifications", "configurationNotifications"):
            notifications = invocation.get(bucket, [])
            if not isinstance(notifications, list):
                reject("local SARIF extraction notifications are malformed")
            for note in notifications:
                if not isinstance(note, dict):
                    reject("local SARIF extraction notification is malformed")
                level = note.get("level", "none")
                if level in {"warning", "error"}:
                    marker = note.get("descriptor", {}).get("id")
                    reject(f"CodeQL extraction/tool warning or error: {marker}")
                descriptor = note.get("descriptor", {})
                marker = descriptor.get("id") if isinstance(descriptor, dict) else None
                locations = note.get("locations", [])
                if not isinstance(locations, list):
                    reject("local SARIF extraction notification locations are malformed")

                uris: set[str] = set()
                for location in locations:
                    if not isinstance(location, dict):
                        reject("local SARIF extraction location is malformed")
                    uri = (
                        location.get("physicalLocation", {})
                        .get("artifactLocation", {})
                        .get("uri")
                    )
                    if isinstance(uri, str) and uri:
                        uris.add(uri)

                if marker == "cli/expected-extracted-files/actions":
                    expected.update(uris)
                if marker == "actions/diagnostics/successfully-extracted-files":
                    extracted.update(uris)

    if not expected or not extracted:
        reject("local SARIF is missing real GitHub Actions source extraction diagnostics")
    missing = sorted(expected - extracted)
    if missing:
        reject(
            f"local SARIF has insufficient GitHub Actions extraction coverage: "
            f"{len(missing)} expected source(s) missing, e.g. {missing[:3]}"
        )

    rules = rule_index(run)
    results = run.get("results")
    if not isinstance(results, list):
        reject("local SARIF results are malformed")

    high_or_critical = 0
    for result in results:
        if not isinstance(result, dict):
            reject("local SARIF contains a malformed result")
        rule_id = result.get("ruleId")
        if not isinstance(rule_id, str) or not rule_id:
            reject("local SARIF result lacks a ruleId")
        rule = rules.get(rule_id)
        if rules and rule is None:
            reject(f"local SARIF result references unknown rule {rule_id!r}")
        if security_score(result, rule) >= 7.0:
            high_or_critical += 1

    if high_or_critical:
        reject(f"local SARIF contains {high_or_critical} High/Critical result(s)")

    return {
        "candidate_sha": head,
        "event": "pull_request",
        "language": "actions",
        "source_sha": head,
        "sarif_file": files[0].name,
        "rules": len(rules),
        "results": len(results),
        "expected_sources": len(expected),
        "extracted_sources": len(extracted),
        "high_or_critical": high_or_critical,
        "trust_domain": "untrusted-pr-codeql-runtime",
        "production_evidence": False,
    }


def self_test(root: Path = ROOT) -> None:
    repo = "luceat-lux-vestra/ox0-blog"
    base = "1" * 40
    head = "2" * 40

    def pr(count: int) -> dict:
        return {
            "changed_files": count,
            "base": {"sha": base, "repo": {"full_name": repo}},
            "head": {"sha": head, "repo": {"full_name": repo}},
        }

    assert classify(
        pr(1),
        [[{"status": "modified", "filename": ".github/workflows/validate.yml"}]],
        repo=repo,
        base=base,
        head=head,
        head_repo=repo,
    )
    assert not classify(
        pr(1),
        [[{"status": "modified", "filename": "README.md"}]],
        repo=repo,
        base=base,
        head=head,
        head_repo=repo,
    )

    old = "a" * 40
    new = "b" * 40
    patch = (
        "@@ -1,2 +1,2 @@\n"
        f"-        uses: github/codeql-action/init@{old}\n"
        f"+        uses: github/codeql-action/init@{new}\n"
        f"-        uses: github/codeql-action/analyze@{old}\n"
        f"+        uses: github/codeql-action/analyze@{new}\n"
    )
    assert classify(
        pr(1),
        [[{
            "status": "modified",
            "filename": ".github/workflows/codeql.yml",
            "patch": patch,
        }]],
        repo=repo,
        base=base,
        head=head,
        head_repo=repo,
    )

    bad = [
        (pr(2), [[{"status": "modified", "filename": ".github/workflows/validate.yml"}]]),
        (pr(1), [[{"status": "mystery", "filename": ".github/workflows/validate.yml"}]]),
        (pr(1), [[{"status": "modified", "filename": "../validate.yml"}]]),
        (pr(2), [[
            {"status": "modified", "filename": ".github/workflows/validate.yml"},
            {"status": "modified", "filename": ".github/workflows/validate.yml"},
        ]]),
        (pr(1), [[{
            "status": "renamed",
            "filename": ".github/workflows/validate.yml",
            "previous_filename": "../old.yml",
        }]]),
    ]
    for meta, pages in bad:
        try:
            classify(meta, pages, repo=repo, base=base, head=head, head_repo=repo)
        except ValueError:
            pass
        else:
            raise AssertionError("unsafe or incomplete changed-file evidence was accepted")

    try:
        classify(
            pr(1),
            [[{
                "status": "modified",
                "filename": ".github/workflows/codeql.yml",
                "patch": "@@ -1 +1 @@\n-security-events: write\n+security-events: read\n",
            }]],
            repo=repo,
            base=base,
            head=head,
            head_repo=repo,
        )
    except ValueError:
        pass
    else:
        raise AssertionError("unsupported direct codeql.yml mutation was accepted")

    current_head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        text=True,
    ).strip()
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        try:
            verify_runtime(directory, current_head, root)
        except ValueError as exc:
            if "expected exactly one SARIF file" not in str(exc):
                raise
        else:
            raise AssertionError("missing SARIF was accepted")

        locations = [
            {
                "physicalLocation": {
                    "artifactLocation": {"uri": ".github/workflows/validate.yml"}
                }
            },
            {
                "physicalLocation": {
                    "artifactLocation": {"uri": ".github/workflows/codeql.yml"}
                }
            },
        ]
        fixture = {
            "version": "2.1.0",
            "runs": [{
                "tool": {"driver": {"name": "CodeQL"}},
                "automationDetails": {"id": "/language:actions/"},
                "invocations": [{
                    "executionSuccessful": True,
                    "toolExecutionNotifications": [
                        {
                            "level": "none",
                            "descriptor": {"id": "cli/expected-extracted-files/actions"},
                            "locations": locations,
                        },
                        {
                            "level": "none",
                            "descriptor": {
                                "id": "actions/diagnostics/successfully-extracted-files"
                            },
                            "locations": locations,
                        },
                    ],
                }],
                "results": [],
            }],
        }
        path = directory / "actions.sarif"
        path.write_text(json.dumps(fixture), encoding="utf-8")
        verdict = verify_runtime(directory, current_head, root)
        assert verdict["expected_sources"] == 2
        assert verdict["extracted_sources"] == 2
        assert verdict["production_evidence"] is False

        broken = json.loads(json.dumps(fixture))
        broken["runs"][0]["invocations"][0]["toolExecutionNotifications"] = [
            broken["runs"][0]["invocations"][0]["toolExecutionNotifications"][0]
        ]
        path.write_text(json.dumps(broken), encoding="utf-8")
        try:
            verify_runtime(directory, current_head, root)
        except ValueError as exc:
            if "missing real GitHub Actions source extraction diagnostics" not in str(exc):
                raise
        else:
            raise AssertionError("missing extracted-source notification was accepted")

    check_contract(root)
    print("trusted CodeQL PR runtime adapter self-tests passed")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("self-test")
    sub.add_parser("check-contract")

    classify_parser = sub.add_parser("classify")
    classify_parser.add_argument("--pr-json", type=Path, required=True)
    classify_parser.add_argument("--files-json", type=Path, required=True)
    classify_parser.add_argument("--repo", required=True)
    classify_parser.add_argument("--base", required=True)
    classify_parser.add_argument("--head", required=True)
    classify_parser.add_argument("--head-repo", required=True)
    classify_parser.add_argument("--github-output", type=Path, required=True)

    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--sarif-dir", type=Path, required=True)
    verify_parser.add_argument("--head", required=True)

    args = parser.parse_args()
    if args.command == "self-test":
        self_test()
    elif args.command == "check-contract":
        check_contract()
        print("selective CodeQL PR runtime contract: PASS")
    elif args.command == "classify":
        required = classify(
            json.loads(args.pr_json.read_text(encoding="utf-8")),
            json.loads(args.files_json.read_text(encoding="utf-8")),
            repo=args.repo,
            base=args.base,
            head=args.head,
            head_repo=args.head_repo,
        )
        with args.github_output.open("a", encoding="utf-8") as stream:
            stream.write(f"required={'true' if required else 'false'}\n")
        print(f"CodeQL runtime required: {'true' if required else 'false'}")
    elif args.command == "verify":
        print(json.dumps(verify_runtime(args.sarif_dir, args.head), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
