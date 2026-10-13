import type { GitPullRequest, GitRepository, IdentityRefWithVote } from "azure-devops-extension-api/Git";
import Constants from "./Constants";

export interface IPullRequestFilters {
    repositories?: GitRepository[];
    creators?: IdentityRefWithVote[];
    reviewers?: IdentityRefWithVote[];
    other?: string[];
}

function getIds(items?: { id: string }[]): string[] {
    return (items || []).filter((item) => { return !!item; }).map((item) => { return item.id; });
}

/**
 * Returns the pull requests that match every selected filter. An empty filter matches all.
 */
export function filterPullRequests(pullRequests: GitPullRequest[], filters: IPullRequestFilters): GitPullRequest[] {
    const repositoryIds = getIds(filters.repositories),
          creatorIds = getIds(filters.creators),
          reviewerIds = getIds(filters.reviewers),
          other = filters.other || [],
          showPublished = other.includes(Constants.IsPublishedKey),
          showDraft = other.includes(Constants.IsDraftKey);

    return pullRequests.filter((item) => {
        if (repositoryIds.length > 0 && !repositoryIds.includes(item.repository.id)) {
            return false;
        }

        if (creatorIds.length > 0 && !creatorIds.includes(item.createdBy.id)) {
            return false;
        }

        if (reviewerIds.length > 0 && !item.reviewers.some((reviewer) => { return reviewerIds.includes(reviewer.id); })) {
            return false;
        }

        // Published / Draft toggles: exactly one selected narrows the list, none or both show all
        if (showPublished && !showDraft) {
            return !item.isDraft;
        }

        if (showDraft && !showPublished) {
            return item.isDraft === true;
        }

        return true;
    });
}

/**
 * Extracts the organization name from a URL such as "https://dev.azure.com/org/"
 */
export function extractOrganization(baseUrl: string): string | undefined {
    const orgMatch = baseUrl.match(/\/\/[^/]+\/([^/]+)\//);

    return orgMatch ? orgMatch[1] : undefined;
}

/**
 * Extracts the descriptor from a GraphProfile/MemberAvatars URL
 * E.g., from "https://dev.azure.com/org/_apis/GraphProfile/MemberAvatars/aad.XXX" returns "aad.XXX"
 */
export function extractDescriptorFromAvatarUrl(avatarUrl: string): string | undefined {
    const match = avatarUrl.match(/\/MemberAvatars\/([^/?]+)/);

    return match ? match[1] : undefined;
}

const MINUTE_MS = 60 * 1000,
      HOUR_MS = 60 * MINUTE_MS,
      DAY_MS = 24 * HOUR_MS;

/**
 * Formats the time between two dates as "12d 3h 45m"
 */
export function formatAge(from: Date, now: Date): string {
    const diff = Math.max(0, now.getTime() - from.getTime()),
          days = Math.floor(diff / DAY_MS),
          hours = Math.floor((diff % DAY_MS) / HOUR_MS),
          minutes = Math.floor((diff % HOUR_MS) / MINUTE_MS);

    return `${days}d ${hours}h ${minutes}m`;
}
