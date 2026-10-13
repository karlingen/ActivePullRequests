import React from "react";
import * as SDK from "azure-devops-extension-sdk";
import { ObservableLike, ObservableValue } from "azure-devops-ui/Core/Observable";
import { IFilter, FILTER_CHANGE_EVENT } from "azure-devops-ui/Utilities/Filter";
import {
    GitPullRequest,
    GitPullRequestCommentThread,
    GitRestClient,
    PullRequestAsyncStatus,
    PullRequestStatus,
    PullRequestTimeRangeType,
    CommentThreadStatus,
    IdentityRefWithVote
} from "azure-devops-extension-api/Git";
import { Card } from "azure-devops-ui/Card";
import { Status, Statuses, StatusSize, IStatusProps } from "azure-devops-ui/Status";
import { Tooltip } from "azure-devops-ui/TooltipEx";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { Ago } from "azure-devops-ui/Ago";
import { Icon, IIconProps } from "azure-devops-ui/Icon";
import { css } from "azure-devops-ui/Util";
import { Link } from "azure-devops-ui/Link";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";

import "./PullRequestsListingPageContent.scss";

import {
    ITableBreakpoint,
    ITableColumn,
    SimpleTableCell,
    Table,
    TwoLineTableCell,
    ColumnSorting,
    SortOrder,
    sortItems
} from "azure-devops-ui/Table";
import Constants from "./Constants";
import { extractDescriptorFromAvatarUrl, extractOrganization, filterPullRequests, formatAge } from "./pull-request-utils";
import { CommonServiceIds, getClient, IExtensionDataManager, IExtensionDataService, IHostNavigationService, IProjectPageService } from "azure-devops-extension-api";
import { AgoFormat } from "azure-devops-ui/Utilities/Date";

// Avatar API constants
const VSSPS_BASE_URL = "https://vssps.dev.azure.com";
const GRAPH_API_VERSION = "7.1";
const GRAPH_AVATAR_PATH = "_apis/graph/Subjects";

// Fixed width so the PR number is never cut, also on narrow tables
const PR_ID_COLUMN_WIDTH = 70;

// Long repository names in the title cell are cut, so the branches and age stay visible
const REPOSITORY_NAME_MAX_WIDTH = 120;

interface IPullRequestsListingPageContentProps {
    filter: IFilter;
    baseUrl: string | undefined;
    filterByPersistedRepositories: () => Promise<void>;
    showOnlyCurrentUser: boolean;
    updatePullrequestCount: (count: number) => void;
    updateUsers?: (creators: IdentityRefWithVote[], reviewers: IdentityRefWithVote[]) => Promise<void>;
}

interface Dictionary<T> {
    [Key: string]: T;
}

// Global caches to persist data across component instances
const commentThreadsCache: { [key: number]: GitPullRequestCommentThread[] } = {};
const avatarCache: { [descriptor: string]: string } = {}; // Maps descriptor to base64 data URL

interface IPullRequestsListingPageContentState {
    filtering: boolean;
    allPullRequests: GitPullRequest[];
    filteredItems: GitPullRequest[];
    commentThreadsByPRId: Dictionary<GitPullRequestCommentThread[]>;
    loading: boolean;
    currentUserId: string;
    avatarDataUrls: Dictionary<string>;
}

interface IStatusIndicatorData {
    statusProps: IStatusProps;
    label: string;
}

class PullRequestsListingPageContent extends React.Component<IPullRequestsListingPageContentProps, IPullRequestsListingPageContentState> {
    private _navigationService: IHostNavigationService;
    private _dataManager?: IExtensionDataManager;
    private _isMounted: boolean = false;
    private _accessToken?: string;

    constructor(props: IPullRequestsListingPageContentProps) {
        super(props);

        this.state = {
            filtering: false,
            filteredItems: [],
            allPullRequests: [],
            commentThreadsByPRId: {},
            loading: true,
            currentUserId: "",
            avatarDataUrls: {}
        };
    }

    async componentDidMount() {
        this._isMounted = true;
        this.props.filter.subscribe(this.onFilterChanged, FILTER_CHANGE_EVENT);

        const gitRestClient: GitRestClient = getClient(GitRestClient);
        const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
        const accessToken = await SDK.getAccessToken();
        this._accessToken = accessToken;
        const extDataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
        const currentUser = SDK.getUser();

        const currentProject = await projectService.getProject();
        const context = SDK.getExtensionContext();
        this._dataManager = await extDataService.getExtensionDataManager(context.publisherId + "." + context.extensionId, accessToken);
        this._navigationService = await SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);

        if (currentProject == null) {
            return;
        }

        const creationDateStart = new Date();
        creationDateStart.setFullYear(creationDateStart.getFullYear() - 10);

        const creationDateEnd = new Date();
        creationDateEnd.setFullYear(creationDateEnd.getFullYear() + 1);

        const pullRequests = await gitRestClient.getPullRequestsByProject(
            currentProject.id,
            {
                creatorId: this.props.showOnlyCurrentUser ? currentUser.id : "",
                includeLinks: false,
                repositoryId: "",
                reviewerId: "",
                sourceRefName: "",
                sourceRepositoryId: "",
                status: PullRequestStatus.Active,
                targetRefName: "",
                minTime: creationDateStart,
                maxTime: creationDateEnd,
                queryTimeRangeType: PullRequestTimeRangeType.Created
            },
            undefined,
            undefined,
            // Top should be set to '0' to retrieve all repositories. Otherwise, there will be a limit of 100 items.
            // We should revisit this when/if this will cause performance issues in the future.
            0);
        if (pullRequests && pullRequests.length > 0) {
            // Set PRs but keep loading state true until filters are applied
            if (this._isMounted) {
                this.setState({
                    allPullRequests: pullRequests,
                    currentUserId: currentUser.id
                });
            }

            // Extract and send users, waiting for dropdowns to populate and user filter preselections to complete
            await this.extractAndSendUsersAsync(pullRequests);
            
            // Apply persisted filters (if any), then ensure filteredItems is populated.
            // onFilterChanged may already have been triggered by setFilterItemState inside
            // filterByPersistedRepositories, but for fresh installs with no persisted filters
            // it won't fire, so we call it explicitly to guarantee filteredItems is set.
            await this.props.filterByPersistedRepositories();
            this.onFilterChanged();
            
            if (this._isMounted) {
                this.setState({ loading: false });
            }
        } else {
            if (this._isMounted) {
                this.setState({ loading: false, currentUserId: currentUser.id });
            }
        }

    }

    componentDidUpdate(prevProps: Readonly<IPullRequestsListingPageContentProps>, prevState: Readonly<IPullRequestsListingPageContentState>, snapshot?: any): void {
        if (this.state.filteredItems.length !== prevState.filteredItems.length) {
            this.props.updatePullrequestCount(this.state.filtering
                ? this.state.filteredItems.length
                : this.state.allPullRequests.length);

            // Ensure comment threads are loaded for the currently visible PRs
            this.ensureThreadsLoadedForPRs(this.state.filteredItems);
            
            // Ensure avatars are loaded for the currently visible PRs
            this.ensureAvatarsLoadedForPRs(this.state.filteredItems);
        }
    }

    componentWillUnmount() {
        this.props.filter.unsubscribe(this.onFilterChanged, FILTER_CHANGE_EVENT);
        this._isMounted = false;
    }

    render() {
        if (this.state.filtering && this.state.filteredItems.length === 0) {
            return (<Card className="flex-self-stretch">No items</Card>);
        }

        if (this.state.loading) {
            return (<Card className="flex-grow flex-center">
                <Spinner className={"margin-8"} size={SpinnerSize.large} />
            </Card>);
        }

        return (
            <Card
                className="flex-grow bolt-card-no-vertical-padding"
                contentProps={{ contentPadding: false }}>
                <Table<GitPullRequest>
                    behaviors={[this.sortingBehavior]}
                    selectableText={true}
                    columns={this.columns}
                    tableBreakpoints={this.tableBreakpoints}
                    itemProvider={new ArrayItemProvider<GitPullRequest>(this.state.filteredItems)}
                    onActivate={(event, data) => {
                        const innerData = data.data;
                        const repository = innerData.repository;

                        this.navigateToPullRequest(repository.project.name, repository.name, innerData.pullRequestId);
                    }}
                />
            </Card>
        );
    }

    private columns: ITableColumn<GitPullRequest>[] = [
        {
            id: "id",
            name: "#",
            readonly: true,
            renderCell: this.getIDRenderCell(),
            sortProps: {
                ariaLabelAscending: "Sorted Ascending",
                ariaLabelDescending: "Sorted Descending"
            },
            width: new ObservableValue(PR_ID_COLUMN_WIDTH)
        },
        {
            id: "createdBy",
            name: "By",
            width: new ObservableValue(-20),
            renderCell: (
                rowIndex: number,
                columnIndex: number,
                tableColumn: ITableColumn<GitPullRequest>,
                tableItem: GitPullRequest): JSX.Element => {
                return (
                    <SimpleTableCell
                        columnIndex={columnIndex}
                        tableColumn={tableColumn}
                        key={"col-" + columnIndex}
                        contentClassName="fontSizeM font-size-m scroll-hidden">
                        <VssPersona imageUrl={this.getAvatarUrl(tableItem.createdBy)} displayName={tableItem.createdBy.displayName} size="small-plus" />
                    </SimpleTableCell>
                );
            },
            sortProps: {
                ariaLabelAscending: "Sorted Ascending",
                ariaLabelDescending: "Sorted Descending"
            },
        },
        {
            id: "repository",
            name: "Repository",
            readonly: true,
            renderCell: (
                rowIndex: number,
                columnIndex: number,
                tableColumn: ITableColumn<GitPullRequest>,
                tableItem: GitPullRequest
            ): JSX.Element => {
                return (
                    <SimpleTableCell
                        columnIndex={columnIndex}
                        tableColumn={tableColumn}
                        key={"col-" + columnIndex}
                        contentClassName="fontSizeM font-size-m scroll-hidden">
                        <div className="flex-row scroll-hidden">
                            <Tooltip overflowOnly={true}>
                                <span className="white-space-normal">{tableItem.repository.name}</span>
                            </Tooltip>
                        </div>
                    </SimpleTableCell>
                );
            },
            sortProps: {
                ariaLabelAscending: "Sorted A to Z",
                ariaLabelDescending: "Sorted Z to A"
            },
            width: new ObservableValue(-30)
        },
        {
            id: "title",
            name: "Title",
            readonly: true,
            renderCell: (
                rowIndex: number,
                columnIndex: number,
                tableColumn: ITableColumn<GitPullRequest>,
                tableItem: GitPullRequest
            ): JSX.Element => {

                const sourceBranchName = tableItem.sourceRefName.split('/').pop();
                const targetBranchName = tableItem.targetRefName.split('/').pop();
                const currentUserIsRequiredReviewer = tableItem.reviewers.some(reviewer => reviewer.isRequired && reviewer.id == this.state.currentUserId);

                return (
                    <TwoLineTableCell
                        className="bolt-table-cell-content-with-inline-link"
                        key={"col-" + columnIndex}
                        columnIndex={columnIndex}
                        tableColumn={tableColumn}
                        line1={
                            <div className="scroll-hidden rhythm-horizontal-4 flex-row">
                                {this.isColumnHidden("mergeStatus") &&
                                    <Status
                                        {...getPullRequestStatusIndicatorData(tableItem.mergeStatus).statusProps}
                                        className="flex-noshrink"
                                        size={StatusSize.s}
                                    />}
                                <Tooltip overflowOnly={true} className="flex-row">
                                    <span className={"white-space-normal"}>{tableItem.title}</span>
                                </Tooltip>

                                <span className="flex-row flex-center">
                                    {tableItem.isDraft && <Pill className="draft-pill" size={PillSize.compact} variant={PillVariant.outlined}>Draft</Pill>}
                                </span>
                                <span className="flex-row flex-center">
                                    {currentUserIsRequiredReviewer && <Pill className="required-pill" size={PillSize.compact} variant={PillVariant.outlined}>Required</Pill>}
                                </span>
                            </div>
                        }
                        line2={
                            <span className="fontSize font-size secondary-text flex-row flex-center text-ellipsis">
                                {this.isColumnHidden("repository") && this.renderHiddenColumnDetails(tableItem)}
                                <Tooltip text={sourceBranchName + " into " + targetBranchName} overflowOnly>
                                    <span className="text-ellipsis" style={{ flexShrink: 10 }}>
                                        <span className="monospaced-xs bolt-table-link bolt-table-inline-link text-ellipsis">
                                            {Icon({
                                                className: "icon-margin",
                                                iconName: "OpenSource",
                                                key: "branch-name",
                                            })}
                                            {sourceBranchName}
                                        </span>
                                        <span>into</span>
                                        <span className="monospaced-xs bolt-table-link bolt-table-inline-link text-ellipsis">
                                            {Icon({
                                                className: "icon-margin",
                                                iconName: "OpenSource",
                                                key: "branch-name",
                                            })}
                                            {targetBranchName}
                                        </span>
                                    </span>
                                </Tooltip>
                            </span>
                        }
                    />
                );
            },
            sortProps: {
                ariaLabelAscending: "Sorted A to Z",
                ariaLabelDescending: "Sorted Z to A"
            },
            width: new ObservableValue(-100)
        },
        {
            id: "createdAt",
            name: "Created",
            readonly: true,
            renderCell: (
                rowIndex: number,
                columnIndex: number,
                tableColumn: ITableColumn<GitPullRequest>,
                tableItem: GitPullRequest
            ): JSX.Element => {
                return (
                    <TwoLineTableCell
                        key={"col-" + columnIndex}
                        columnIndex={columnIndex}
                        tableColumn={tableColumn}
                        line1={WithIcon({
                            className: "fontSize font-size",
                            iconProps: { iconName: "Calendar" },
                            children: (
                                <Ago date={tableItem.creationDate} format={AgoFormat.Extended} />
                            ),
                        })}
                        line2={WithIcon({
                            className: "fontSize font-size secondary-text",
                            iconProps: { iconName: "Clock" },
                            children: formatAge(tableItem.creationDate, new Date()),
                        })} />
                );
            },
            sortProps: {
                ariaLabelAscending: "Sorted oldest to newest",
                ariaLabelDescending: "Sorted newest to oldest"
            },
            width: new ObservableValue(-50),
            ariaLabel: "Created at"
        },
        {
            id: "mergeStatus",
            name: "Merge Status",
            readonly: true,
            headerClassName: "centered-header",
            renderCell: (
                rowIndex: number,
                columnIndex: number,
                tableColumn: ITableColumn<GitPullRequest>,
                tableItem: GitPullRequest
            ): JSX.Element => {
                return (
                    <SimpleTableCell
                        columnIndex={columnIndex}
                        tableColumn={tableColumn}
                        key={"col-" + columnIndex}
                        contentClassName="fontSizeM font-size-m scroll-hidden justify-center">
                        <Status
                            {...getPullRequestStatusIndicatorData(tableItem.mergeStatus).statusProps}
                            className="icon-large-margin"
                            size={StatusSize.m}
                        />
                    </SimpleTableCell>
                );
            },
            width: new ObservableValue(-30)
        },
        {
            id: "comments",
            name: "Comments",
            readonly: true,
            headerClassName: "centered-header",
            renderCell: (
                rowIndex: number,
                columnIndex: number,
                tableColumn: ITableColumn<GitPullRequest>,
                tableItem: GitPullRequest
            ): JSX.Element => {

                const { className, displayText, tooltipText } = this.getCommentSummary(tableItem);

                return (
                    <SimpleTableCell
                        columnIndex={columnIndex}
                        tableColumn={tableColumn}
                        key={"col-" + columnIndex}
                        contentClassName="fontSizeM font-size-m scroll-hidden justify-center">
                        <Tooltip text={tooltipText}>
                            <span className={className}>{displayText}</span>
                        </Tooltip>
                    </SimpleTableCell>
                );
            },
            width: new ObservableValue(-25)
        },
        {
            id: "reviewers",
            name: "Reviewers",
            readonly: true,
            renderCell: (
                rowIndex: number,
                columnIndex: number,
                tableColumn: ITableColumn<GitPullRequest>,
                tableItem: GitPullRequest): JSX.Element => {
                return (
                    <SimpleTableCell
                        columnIndex={columnIndex}
                        tableColumn={tableColumn}
                        key={"col-" + columnIndex}
                        contentClassName="fontSizeM font-size-m scroll-hidden flex-wrap">
                        {tableItem.reviewers.map((reviewer) => {
                            const statusIndicatorData = getVoteStatusIndicatorData(reviewer.vote);
                            return <React.Fragment key={reviewer.id}>
                                <Tooltip overflowOnly={false} text={reviewer.displayName}>
                                    <div className={"flex-column margin-right-4 relative"}>
                                        <VssPersona imageUrl={this.getAvatarUrl(reviewer)} displayName={reviewer.displayName} size={"small"} />
                                        <Status
                                            {...statusIndicatorData.statusProps}
                                            size={StatusSize.m}
                                            className={"persona-status-badge absolute"} />
                                    </div>
                                </Tooltip>
                            </React.Fragment>
                        })}

                    </SimpleTableCell>
                );
            },
            width: new ObservableValue(-40)
        }
    ];

    // Column widths per table width, in the order of this.columns. 0 hides the column.
    // The first breakpoint must be above 0, because a 0 gives the IntersectionObserver in
    // Breakpoint a negative threshold. Narrower tables still use the first entry.
    private tableBreakpoints: ITableBreakpoint[] = [
        // Phone: #, Title, Reviewers
        { breakpoint: 1, columnWidths: [PR_ID_COLUMN_WIDTH, 0, 0, -100, 0, 0, 0, -40] },
        // Tablet: #, By, Title, Merge Status, Reviewers
        { breakpoint: 600, columnWidths: [PR_ID_COLUMN_WIDTH, -20, 0, -100, 0, 120, 0, -40] },
        { breakpoint: 1100, columnWidths: [PR_ID_COLUMN_WIDTH, -20, -30, -100, -50, -30, -25, -40] }
    ];

    private async ensureThreadsLoadedForPRs(pullRequests: GitPullRequest[]) {
        // First, hydrate component state from cache for any visible PRs
        // that have cached threads but are not yet present in state.
        const fromCache: Dictionary<GitPullRequestCommentThread[]> = {};
        for (const pr of pullRequests) {
            const id = pr.pullRequestId;
            const inState = Object.prototype.hasOwnProperty.call(this.state.commentThreadsByPRId, id);
            const inCache = Object.prototype.hasOwnProperty.call(commentThreadsCache, id);
            if (!inState && inCache) {
                fromCache[id] = commentThreadsCache[id];
            }
        }

        if (Object.keys(fromCache).length > 0 && this._isMounted) {
            this.setState(prev => ({
                commentThreadsByPRId: { ...prev.commentThreadsByPRId, ...fromCache }
            }));
        }

        // Determine which PRs need fetching (not already in state or cache)
        const toFetch = pullRequests.filter(pr =>
            !Object.prototype.hasOwnProperty.call(this.state.commentThreadsByPRId, pr.pullRequestId) &&
            !Object.prototype.hasOwnProperty.call(commentThreadsCache, pr.pullRequestId)
        );

        if (toFetch.length > 0) {
            // Fire and forget; do not block UI
            this.fetchCommentThreadsForPRs(toFetch);
        }
    }

    private async fetchCommentThreadsForPRs(pullRequests: GitPullRequest[]) {
        const gitRestClient: GitRestClient = getClient(GitRestClient);
        const maxConcurrency = 6; // Avoid overloading the API/browser
        let index = 0;

        const worker = async () => {
            let localBatch: Dictionary<GitPullRequestCommentThread[]> = {};
            const batchSize = 10;
            while (true) {
                const i = index++;
                if (i >= pullRequests.length) {
                    break;
                }
                const pr = pullRequests[i];

                // Skip if already cached (race-safe check)
                if (Object.prototype.hasOwnProperty.call(commentThreadsCache, pr.pullRequestId)) {
                    localBatch[pr.pullRequestId] = commentThreadsCache[pr.pullRequestId];
                } else {
                    try {
                        const threads = await gitRestClient.getThreads(pr.repository.id, pr.pullRequestId);
                        const filtered = threads?.filter(x => !x.isDeleted && (x.status == CommentThreadStatus.Active || x.status == CommentThreadStatus.Fixed)) ?? [];
                        commentThreadsCache[pr.pullRequestId] = filtered;
                        localBatch[pr.pullRequestId] = filtered;
                    } catch (e) {
                        // On error, store empty to avoid blocking UI
                        commentThreadsCache[pr.pullRequestId] = [];
                        localBatch[pr.pullRequestId] = [];
                    }
                }

                if (Object.keys(localBatch).length >= batchSize) {
                    const toApply = localBatch;
                    localBatch = {};
                    if (this._isMounted) {
                        this.setState(prev => ({
                            commentThreadsByPRId: { ...prev.commentThreadsByPRId, ...toApply }
                        }));
                    }
                }
            }

            // Flush any remaining items in this worker's batch
            if (Object.keys(localBatch).length > 0) {
                const toApply = localBatch;
                if (this._isMounted) {
                    this.setState(prev => ({
                        commentThreadsByPRId: { ...prev.commentThreadsByPRId, ...toApply }
                    }));
                }
            }
        };

        await Promise.all(new Array(maxConcurrency).fill(0).map(() => worker()));
    }

    private getPRUrl(projectName: string, repositoryName: string, pullRequestId): string {
        return this.props.baseUrl + encodeURIComponent(projectName) + '/_git/' + encodeURIComponent(repositoryName) + '/pullRequest/' + pullRequestId;
    }

    /**
     * Returns true when the current table breakpoint hides the column.
     */
    private isColumnHidden(columnId: string): boolean {
        const column = this.columns.find((col) => { return col.id === columnId; });

        return !!column && ObservableLike.getValue(column.width) === 0;
    }

    /**
     * Shows the creator, repository, age, and comments in the title cell, for
     * narrow tables that hide those columns.
     */
    private renderHiddenColumnDetails(tableItem: GitPullRequest): JSX.Element {
        const comments = this.getCommentSummary(tableItem);

        return (
            <span className="flex-row flex-center flex-noshrink rhythm-horizontal-8 margin-right-8">
                {this.isColumnHidden("createdBy") &&
                    <VssPersona className="flex-noshrink" imageUrl={this.getAvatarUrl(tableItem.createdBy)} displayName={tableItem.createdBy.displayName} size="extra-small" />}
                <span className="text-ellipsis" style={{ maxWidth: REPOSITORY_NAME_MAX_WIDTH }}>{tableItem.repository.name}</span>
                <Tooltip text={tableItem.creationDate.toLocaleString()}>
                    {WithIcon({ className: "flex-noshrink", iconProps: { iconName: "Clock" }, children: formatAge(tableItem.creationDate, new Date()) })}
                </Tooltip>
                {comments.displayText &&
                    <Tooltip text={comments.tooltipText}>
                        <span className="flex-row flex-center flex-noshrink">
                            {Icon({ className: "icon-margin", iconName: "Comment" })}
                            <span className={comments.className}>{comments.displayText}</span>
                        </span>
                    </Tooltip>}
            </span>
        );
    }

    /**
     * Counts the resolved comment threads of a pull request for display.
     */
    private getCommentSummary(tableItem: GitPullRequest): { className: string; displayText: string; tooltipText: string } {
        const hasThreads = Object.prototype.hasOwnProperty.call(this.state.commentThreadsByPRId, tableItem.pullRequestId);

        if (!hasThreads) {
            return { className: "", displayText: "…", tooltipText: "Loading comments" };
        }

        const threads = this.state.commentThreadsByPRId[tableItem.pullRequestId],
              total = threads.length,
              resolved = threads.filter((x) => { return x.status != CommentThreadStatus.Active; }).length,
              unresolved = total - resolved;

        return {
            className: resolved == total ? "has-only-resolved-comments" : "has-unresolved-comments",
            displayText: total == 0 ? "" : `${resolved}/${total}`,
            tooltipText: total == resolved ? "No unresolved comments" : `${unresolved} unresolved ${unresolved == 1 ? "comment" : "comments"}`,
        };
    }

    private getIDRenderCell(): (rowIndex: number, columnIndex: number, tableColumn: ITableColumn<GitPullRequest>, tableItem: GitPullRequest, ariaRowIndex?: number | undefined) => JSX.Element {
        return (
            rowIndex: number,
            columnIndex: number,
            tableColumn: ITableColumn<GitPullRequest>,
            tableItem: GitPullRequest
        ): JSX.Element => {
            const { repository, pullRequestId } = tableItem;

            return (
                <SimpleTableCell
                    columnIndex={columnIndex}
                    tableColumn={tableColumn}
                    key={"col-" + columnIndex}
                    contentClassName="fontSizeM font-size-m scroll-hidden">
                    <div className="flex-row scroll-hidden">
                        <Link
                            href={this.getPRUrl(repository.project.name, repository.name, pullRequestId)}
                            className="no-underline-link"
                            onClick={(e) => {
                                e.preventDefault()
                                this.navigateToPullRequest(repository.project.name, repository.name, pullRequestId);
                            }}>
                            <Tooltip overflowOnly={true}>
                                <span>{pullRequestId}</span>
                            </Tooltip>
                        </Link>
                    </div>
                </SimpleTableCell>
            );
        };
    }

    private onFilterChanged = async () => {
        // Read ALL current filter states from the filter object
        const repositoriesState = this.props.filter.getFilterItemState(Constants.RepositoriesFilterKey);
        const creatorsState = this.props.filter.getFilterItemState(Constants.CreatedByFilterKey);
        const reviewersState = this.props.filter.getFilterItemState(Constants.ReviewersFilterKey);
        const otherState = this.props.filter.getFilterItemState(Constants.OtherFilterKey);
        
        const filteredPullRequests = filterPullRequests(this.state.allPullRequests, {
            repositories: repositoriesState?.value,
            creators: creatorsState?.value,
            reviewers: reviewersState?.value,
            other: otherState?.value
        });

        this.setState({
            filtering: this.props.filter.hasChangesToReset(),
            filteredItems: filteredPullRequests
        });

        // Persist all filter states to user storage
        if (repositoriesState !== null && repositoriesState !== undefined) {
            await this._dataManager?.setValue(Constants.UserRepositoriesKey, repositoriesState, { scopeType: "User" });
        }
        
        if (creatorsState !== null && creatorsState !== undefined) {
            await this._dataManager?.setValue(Constants.UserCreatedByKey, creatorsState, { scopeType: "User" });
        }
        
        if (reviewersState !== null && reviewersState !== undefined) {
            await this._dataManager?.setValue(Constants.UserReviewersKey, reviewersState, { scopeType: "User" });
        }
        
        if (otherState !== null && otherState !== undefined) {
            await this._dataManager?.setValue(Constants.UserOtherKey, otherState, { scopeType: "User" });
        }

        // Ensure we load threads for the currently visible PRs only
        this.ensureThreadsLoadedForPRs(filteredPullRequests);
    };

    private sortFunctions = [
        // ID
        (item1: GitPullRequest, item2: GitPullRequest): number => {
            return item1.pullRequestId < item2.pullRequestId ? -1 : item1.pullRequestId > item2.pullRequestId ? 1 : 0;
        },

        // By
        (item1: GitPullRequest, item2: GitPullRequest): number => {
            return item1.createdBy.displayName.localeCompare(item2.createdBy.displayName);
        },

        // Repository
        (item1: GitPullRequest, item2: GitPullRequest): number => {
            return item1.repository.name.localeCompare(item2.repository.name);
        },

        // Title
        (item1: GitPullRequest, item2: GitPullRequest): number => {
            return item1.title.localeCompare(item2.title);
        },

        // Created Date
        (item1: GitPullRequest, item2: GitPullRequest): number => {
            return item1.creationDate < item2.creationDate ? -1 : item1.creationDate > item2.creationDate ? 1 : 0;
        },
    ];

    // Create the sorting behavior (delegate that is called when a column is sorted).
    private sortingBehavior = new ColumnSorting<GitPullRequest>(
        (columnIndex: number, proposedSortOrder: SortOrder, event: React.KeyboardEvent<HTMLElement> | React.MouseEvent<HTMLElement>
        ) => {
            const sortedItems = sortItems(
                columnIndex,
                proposedSortOrder,
                this.sortFunctions,
                this.columns,
                this.state.filteredItems
            );

            this.setState({ filteredItems: sortedItems });
        }
    );

    private navigateToPullRequest(projectName: string, repositoryName: string, pullRequestId: number) {
        this._navigationService.navigate(this.getPRUrl(projectName, repositoryName, pullRequestId));
    }

    private async extractAndSendUsersAsync(pullRequests: GitPullRequest[]): Promise<void> {
        if (!this.props.updateUsers) {
            return;
        }

        const creatorMap = new Map<string, IdentityRefWithVote>();
        const reviewerMap = new Map<string, IdentityRefWithVote>();

        for (const pr of pullRequests) {
            // Add creator
            if (pr.createdBy && pr.createdBy.id) {
                creatorMap.set(pr.createdBy.id, pr.createdBy as IdentityRefWithVote);
            }

            // Add reviewers
            if (pr.reviewers) {
                for (const reviewer of pr.reviewers) {
                    if (reviewer && reviewer.id) {
                        reviewerMap.set(reviewer.id, reviewer);
                    }
                }
            }
        }

        const uniqueCreators = Array.from(creatorMap.values()).sort((a, b) => 
            (a.displayName || '').localeCompare(b.displayName || '')
        );
        const uniqueReviewers = Array.from(reviewerMap.values()).sort((a, b) => 
            (a.displayName || '').localeCompare(b.displayName || '')
        );

        await this.props.updateUsers(uniqueCreators, uniqueReviewers);
    }

    /**
     * Builds the Graph API URL for fetching avatar data
     */
    private buildGraphAvatarUrl(organization: string, descriptor: string): string {
        return `${VSSPS_BASE_URL}/${organization}/${GRAPH_AVATAR_PATH}/${encodeURIComponent(descriptor)}/avatars?api-version=${GRAPH_API_VERSION}`;
    }

    /**
     * Fetches avatar from Graph API and converts base64 data to data URL
     * Results are cached to avoid redundant API calls
     */
    private async fetchAvatarAsDataUrl(descriptor: string): Promise<string | undefined> {
        if (!this.props.baseUrl || !this._accessToken) {
            return undefined;
        }

        // Check cache first
        if (avatarCache[descriptor]) {
            return avatarCache[descriptor];
        }

        try {
            const organization = extractOrganization(this.props.baseUrl);
            if (!organization) {
                return undefined;
            }

            const url = this.buildGraphAvatarUrl(organization, descriptor);
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this._accessToken}`,
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                console.error(`Avatar fetch failed: ${response.status} ${response.statusText}`);
                return undefined;
            }

            const data = await response.json();
            if (data.value) {
                const dataUrl = `data:image/png;base64,${data.value}`;
                avatarCache[descriptor] = dataUrl;
                return dataUrl;
            }
        } catch (error) {
            console.error('Error fetching avatar:', error);
        }

        return undefined;
    }

    /**
     * Ensures avatars are loaded for all users in the visible pull requests
     * Fetches missing avatars in parallel with concurrency control
     */
    private async ensureAvatarsLoadedForPRs(pullRequests: GitPullRequest[]) {
        const descriptorsToFetch: string[] = [];
        const identities: Array<{ descriptor: string }> = [];

        // Collect all unique descriptors from creators and reviewers
        for (const pr of pullRequests) {
            // Add creator descriptor
            if (pr.createdBy?.descriptor) {
                identities.push({ descriptor: pr.createdBy.descriptor });
            }
            
            // Add reviewer descriptors
            if (pr.reviewers) {
                for (const reviewer of pr.reviewers) {
                    // Try direct descriptor property first
                    if (reviewer.descriptor) {
                        identities.push({ descriptor: reviewer.descriptor });
                    }
                    // If no direct descriptor, try extracting from _links.avatar.href
                    else if (reviewer._links?.avatar?.href) {
                        const descriptor = extractDescriptorFromAvatarUrl(reviewer._links.avatar.href);
                        if (descriptor) {
                            identities.push({ descriptor });
                        }
                    }
                }
            }
        }

        // Find descriptors not yet cached
        for (const identity of identities) {
            const inCache = avatarCache[identity.descriptor] !== undefined;
            const inState = this.state.avatarDataUrls[identity.descriptor] !== undefined;
            if (!inCache && !inState && !descriptorsToFetch.includes(identity.descriptor)) {
                descriptorsToFetch.push(identity.descriptor);
            }
        }

        // Fetch avatars in parallel (but limit concurrency)
        if (descriptorsToFetch.length > 0) {
            const maxConcurrency = 6;
            const results: Dictionary<string> = {};

            const fetchBatch = async (descriptors: string[]) => {
                await Promise.all(
                    descriptors.map(async (descriptor) => {
                        const dataUrl = await this.fetchAvatarAsDataUrl(descriptor);
                        if (dataUrl) {
                            results[descriptor] = dataUrl;
                        }
                    })
                );
            };

            // Process in batches
            for (let i = 0; i < descriptorsToFetch.length; i += maxConcurrency) {
                const batch = descriptorsToFetch.slice(i, i + maxConcurrency);
                await fetchBatch(batch);
            }

            // Update state with fetched avatars
            if (Object.keys(results).length > 0 && this._isMounted) {
                this.setState(prev => ({
                    avatarDataUrls: { ...prev.avatarDataUrls, ...results }
                }));
            }
        }
    }

    /**
     * Gets the avatar URL for an identity
     * Prioritizes cached data URLs from Graph API, then falls back to default image URLs
     */
    private getAvatarUrl(identity?: { id?: string; imageUrl?: string; descriptor?: string; _links?: any }): string | undefined {
        if (!identity) {
            return undefined;
        }
        
        // Try to get descriptor from identity or extract from _links.avatar.href
        let descriptor = identity.descriptor;
        if (!descriptor && identity._links?.avatar?.href) {
            descriptor = extractDescriptorFromAvatarUrl(identity._links.avatar.href);
        }
        
        // Use cached data URL if available (fetched from Graph API)
        if (descriptor) {
            const cachedDataUrl = avatarCache[descriptor] || this.state.avatarDataUrls[descriptor];
            if (cachedDataUrl) {
                return cachedDataUrl;
            }
        }
        
        // Fall back to _links.avatar.href or imageUrl
        return identity._links?.avatar?.href || identity.imageUrl;
    }
}


function getPullRequestStatusIndicatorData(status: PullRequestAsyncStatus): IStatusIndicatorData {
    switch (status) {
        case PullRequestAsyncStatus.Conflicts:
        case PullRequestAsyncStatus.Failure:
        case PullRequestAsyncStatus.RejectedByPolicy:
            return { statusProps: Statuses.Failed, label: "Failed" }
        case PullRequestAsyncStatus.Succeeded:
            return { statusProps: Statuses.Success, label: "Success" }
    }

    return { statusProps: Statuses.Queued, label: "Unknown" }
}

function getVoteStatusIndicatorData(vote: number): IStatusIndicatorData {
    // This is from the 'vote' method docs (I can't find a constant):
    // 10 - approved 
    // 5 - approved with suggestions
    // 0 - no vote
    // -5 - waiting for author
    // -10 - rejected
    if (vote === 10) {
        return { statusProps: Statuses.Success, label: "Approved" }
    } else if (vote === 5) {
        return { statusProps: Statuses.Success, label: "Approved with suggestions" }
    } else if (vote === -5) {
        const waitingStatus = Statuses.Waiting;
        waitingStatus.color = "warning"
        return { statusProps: waitingStatus, label: "Waiting for author" }
    } else if (vote === -10) {
        return { statusProps: Statuses.Failed, label: "Rejected" }
    }

    return { statusProps: Statuses.Queued, label: "Unknown" }
}

function WithIcon(props: {
    className?: string;
    iconProps: IIconProps;
    children?: React.ReactNode;
}) {
    return (
        <div className={css(props.className, "flex-row flex-center")}>
            {Icon({ ...props.iconProps, className: "icon-margin" })}
            {props.children}
        </div>
    );
}

export default PullRequestsListingPageContent;
