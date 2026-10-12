import { describe, expect, test } from "@jest/globals";
import type { GitPullRequest, GitRepository, IdentityRefWithVote } from "azure-devops-extension-api/Git";
import Constants from "./Constants";
import { extractDescriptorFromAvatarUrl, extractOrganization, filterPullRequests } from "./pull-request-utils";

function makePullRequest(id: number, repoId: string, creatorId: string, reviewerIds: string[], isDraft: boolean): GitPullRequest {
    return {
        pullRequestId: id,
        repository: { id: repoId },
        createdBy: { id: creatorId },
        reviewers: reviewerIds.map((reviewerId) => { return { id: reviewerId }; }),
        isDraft,
    } as unknown as GitPullRequest;
}

function repo(id: string): GitRepository {
    return { id } as GitRepository;
}

function user(id: string): IdentityRefWithVote {
    return { id } as IdentityRefWithVote;
}

function ids(pullRequests: GitPullRequest[]): number[] {
    return pullRequests.map((pr) => { return pr.pullRequestId; });
}

const PULL_REQUESTS = [
    makePullRequest(1, "repo-a", "alice", [ "bob" ], false),
    makePullRequest(2, "repo-a", "bob", [ "alice", "carol" ], true),
    makePullRequest(3, "repo-b", "alice", [], false),
];

describe("filterPullRequests", () => {
    test("returns everything when no filter is set", () => {
        expect(ids(filterPullRequests(PULL_REQUESTS, {}))).toEqual([ 1, 2, 3 ]);
    });

    test("filters by repository", () => {
        expect(ids(filterPullRequests(PULL_REQUESTS, { repositories: [ repo("repo-b") ] }))).toEqual([ 3 ]);
    });

    test("ignores null entries in a persisted selection", () => {
        const repositories = [ null, repo("repo-a") ] as unknown as GitRepository[];

        expect(ids(filterPullRequests(PULL_REQUESTS, { repositories }))).toEqual([ 1, 2 ]);
    });

    test("filters by creator and reviewer together", () => {
        const filters = { creators: [ user("bob") ], reviewers: [ user("carol") ] };

        expect(ids(filterPullRequests(PULL_REQUESTS, filters))).toEqual([ 2 ]);
    });

    test("Published only hides drafts", () => {
        expect(ids(filterPullRequests(PULL_REQUESTS, { other: [ Constants.IsPublishedKey ] }))).toEqual([ 1, 3 ]);
    });

    test("Draft only shows drafts", () => {
        expect(ids(filterPullRequests(PULL_REQUESTS, { other: [ Constants.IsDraftKey ] }))).toEqual([ 2 ]);
    });

    test("Published and Draft together show everything", () => {
        const other = [ Constants.IsPublishedKey, Constants.IsDraftKey ];

        expect(ids(filterPullRequests(PULL_REQUESTS, { other }))).toEqual([ 1, 2, 3 ]);
    });
});

describe("URL helpers", () => {
    test("extractOrganization reads the first path segment", () => {
        expect(extractOrganization("https://dev.azure.com/my-org/")).toBe("my-org");
        expect(extractOrganization("https://dev.azure.com")).toBeUndefined();
    });

    test("extractDescriptorFromAvatarUrl stops at the query string", () => {
        const url = "https://dev.azure.com/org/_apis/GraphProfile/MemberAvatars/aad.XXX?size=2";

        expect(extractDescriptorFromAvatarUrl(url)).toBe("aad.XXX");
        expect(extractDescriptorFromAvatarUrl("https://example.com/avatar.png")).toBeUndefined();
    });
});
