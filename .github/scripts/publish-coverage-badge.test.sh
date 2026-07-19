#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
publisher="$script_dir/publish-coverage-badge.sh"
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT

badge_path="$test_dir/coverage.svg"
mock_log="$test_dir/gh.log"
printf '<svg>coverage</svg>' > "$badge_path"
: > "$mock_log"

gh() {
    local arguments="$*"

    if [[ "$arguments" == *'git/ref/heads/main'* ]]; then
        printf '%s\n' "$MOCK_MAIN_SHA"
        return 0
    fi

    if [[ "$arguments" == *'--method POST'* || "$arguments" == *'--method PUT'* ]]; then
        printf '%s\n' "$arguments" >> "$MOCK_GH_LOG"
        return 0
    fi

    if [[ "$arguments" == *'git/ref/heads/badges'* ]]; then
        [[ "$MOCK_BADGES_REF_EXISTS" == 'true' ]]
        return
    fi

    if [[ "$arguments" == *'contents/coverage.svg'* && "$arguments" == *'--jq .content'* ]]; then
        if [[ -n "$MOCK_EXISTING_CONTENT" ]]; then
            printf '%s\n' "$MOCK_EXISTING_CONTENT"
            return 0
        fi

        return 1
    fi

    if [[ "$arguments" == *'contents/coverage.svg'* && "$arguments" == *'--jq .sha'* ]]; then
        if [[ -n "$MOCK_EXISTING_SHA" ]]; then
            printf '%s\n' "$MOCK_EXISTING_SHA"
            return 0
        fi

        return 1
    fi

    return 1
}

export -f gh
export GITHUB_REPOSITORY='php-skir/skir-laravel-data-generator'
export MOCK_GH_LOG="$mock_log"
export MOCK_MAIN_SHA='latest-main-sha'
export MOCK_BADGES_REF_EXISTS='true'
export MOCK_EXISTING_CONTENT='different-badge-content'
export MOCK_EXISTING_SHA='existing-badge-sha'

export GITHUB_SHA='older-main-sha'
bash "$publisher" "$badge_path"

if [[ -s "$mock_log" ]]; then
    echo 'A stale workflow run attempted to mutate the badge branch.' >&2
    exit 1
fi

export GITHUB_SHA='latest-main-sha'
bash "$publisher" "$badge_path"

badge_content=$(base64 < "$badge_path" | tr -d '\n')
expected_update="api --method PUT repos/$GITHUB_REPOSITORY/contents/coverage.svg -f message=Update coverage badge -f content=$badge_content -f branch=badges -f sha=existing-badge-sha"

if [[ $(< "$mock_log") != "$expected_update" ]]; then
    echo 'The latest main workflow run did not update the badge exactly as intended.' >&2
    exit 1
fi

: > "$mock_log"
export MOCK_BADGES_REF_EXISTS='false'
export MOCK_EXISTING_CONTENT=''
export MOCK_EXISTING_SHA=''
bash "$publisher" "$badge_path"

expected_create="api --method POST repos/$GITHUB_REPOSITORY/git/refs -f ref=refs/heads/badges -f sha=latest-main-sha"
expected_publish="api --method PUT repos/$GITHUB_REPOSITORY/contents/coverage.svg -f message=Add coverage badge -f content=$badge_content -f branch=badges"
expected_log=$(printf '%s\n%s' "$expected_create" "$expected_publish")

if [[ $(< "$mock_log") != "$expected_log" ]]; then
    echo 'The latest main workflow run did not create and publish the badge exactly as intended.' >&2
    exit 1
fi
