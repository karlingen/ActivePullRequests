import React from "react";
import * as SDK from "azure-devops-extension-sdk";
import { ObservableValue } from "azure-devops-ui/Core/Observable";
import { IFilter, Filter, FILTER_CHANGE_EVENT, IFilterState } from "azure-devops-ui/Utilities/Filter";
import { GitPullRequest, GitPullRequestStatus, GitRepository, GitRestClient, PullRequestAsyncStatus, PullRequestStatus } from "azure-devops-extension-api/Git";
import { Card } from "azure-devops-ui/Card";
import { Status, Statuses, StatusSize, IStatusProps } from "azure-devops-ui/Status";
import { Tooltip } from "azure-devops-ui/TooltipEx";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { Ago } from "azure-devops-ui/Ago";
import { Icon, IconSize, IIconProps } from "azure-devops-ui/Icon";
import { css } from "azure-devops-ui/Util";
import { Link } from "azure-devops-ui/Link";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";

import "./PullRequestsListingPageContent.scss";

import {
    ITableColumn,
    SimpleTableCell,
    Table,
    TwoLineTableCell,
    ColumnSorting,
    SortOrder,
    sortItems,
} from "azure-devops-ui/Table";
import Constants from "./Constants";
import { CommonServiceIds, getClient, IExtensionDataManager, IExtensionDataService, IHostNavigationService, IProjectPageService } from "azure-devops-extension-api";
import { AgoFormat } from "azure-devops-ui/Utilities/Date";

interface IPullRequestsListingPageContentProps {
    filter: IFilter;
    baseUrl: string | undefined;
    filterByPersistedRepositories: () => void;
    showOnlyCurrentUser: boolean;
}

interface IPullRequestsListingPageContentState {
    filtering: boolean;
    allPullRequests: GitPullRequest[];
    filteredItems: GitPullRequest[];
    loading: boolean;
    currentUserId: string;
}

interface IStatusIndicatorData {
    statusProps: IStatusProps;
    label: string;
}

class PullRequestsListingPageContent extends React.Component<IPullRequestsListingPageContentProps, IPullRequestsListingPageContentState> {
    private _navigationService: IHostNavigationService;
    private _dataManager?: IExtensionDataManager;

    constructor(props: IPullRequestsListingPageContentProps) {
        super(props);

        this.state = {
            filtering: false,
            filteredItems: [],
            allPullRequests: [],
            loading: true,
            currentUserId: ""
        };
    }

    async componentDidMount() {
        this.props.filter.subscribe(this.onFilterChanged, FILTER_CHANGE_EVENT);

        const gitRestClient: GitRestClient = getClient(GitRestClient);
        const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
        const accessToken = await SDK.getAccessToken();
        const extDataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
        const currentUser = SDK.getUser();

        const currentProject = await projectService.getProject();
        const context = SDK.getExtensionContext();
        this._dataManager = await extDataService.getExtensionDataManager(context.publisherId + "." + context.extensionId, accessToken);
        this._navigationService = await SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);

        if (currentProject == null) {
            return;
        }

        let pullRequests = await gitRestClient.getPullRequestsByProject(currentProject.id, {
            creatorId: this.props.showOnlyCurrentUser ? currentUser.id : "",
            includeLinks: false,
            repositoryId: "",
            reviewerId: "",
            sourceRefName: "",
            sourceRepositoryId: "",
            status: PullRequestStatus.Active,
            targetRefName: ""
        },
            undefined,
            undefined,
            // Top should be set to '0' to retrieve all repositories. Otherwise, there will be a limit of 100 items.
            // We should revisit this when/if this will cause performance issues in the future.
            0);

        if (pullRequests && pullRequests.length > 0) {
            this.setState({
                allPullRequests: pullRequests
            })

            // Now that all the await calls are done, we are ready to filter by perferred repos.
            this.props.filterByPersistedRepositories();
        }

        this.setState({ loading: false, currentUserId: currentUser.id });
    }

    componentWillUnmount() {
        this.props.filter.unsubscribe(this.onFilterChanged, FILTER_CHANGE_EVENT);
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
            width: new ObservableValue(-15)
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
                        <VssPersona imageUrl={tableItem.createdBy.imageUrl} displayName={tableItem.createdBy.displayName} size="small-plus" />
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

                let sourceBranchName = tableItem.sourceRefName.split('/').pop();
                let targetBranchName = tableItem.targetRefName.split('/').pop();
                let currentUserIsRequiredReviewer = tableItem.reviewers.some(reviewer => reviewer.isRequired && reviewer.id == this.state.currentUserId);

                return (
                    <TwoLineTableCell
                        className="bolt-table-cell-content-with-inline-link"
                        key={"col-" + columnIndex}
                        columnIndex={columnIndex}
                        tableColumn={tableColumn}
                        line1={
                            <div className="scroll-hidden rhythm-horizontal-4 flex-row">
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
                        line2={null} />
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
                        {tableItem.reviewers.map((reviewer, index) => {
                            let statusIndicatorData = getVoteStatusIndicatorData(reviewer.vote);
                            return <React.Fragment key={index}>
                                <Tooltip overflowOnly={false} text={reviewer.displayName}>
                                    <div className={"flex-column margin-right-4 relative"}>
                                        <VssPersona imageUrl={reviewer.imageUrl} displayName={reviewer.displayName} size={"small"} />
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

    private getPRUrl(projectName: string, repositoryName: string, pullRequestId): string {
        return this.props.baseUrl + encodeURIComponent(projectName) + '/_git/' + encodeURIComponent(repositoryName) + '/pullRequest/' + pullRequestId;
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

    private onFilterChanged = async ({ repositoriesFilterKey }: IFilterState) => {
        const selectedRepositories: GitRepository[] = repositoriesFilterKey?.value;
        const filteredPullRequests = this.filterItems(selectedRepositories);

        this.setState({
            filtering: this.props.filter.hasChangesToReset(),
            filteredItems: filteredPullRequests
        });

        // Persist to user storage
        const stateToPersist = this.props.filter.getFilterItemState(Constants.RepositoriesFilterKey);
        if (stateToPersist !== null && stateToPersist !== undefined) {
            await this._dataManager?.setValue(Constants.UserRepositoriesKey, stateToPersist, { scopeType: "User" });
        }
    };

    private filterItems = (selectedRepositories: GitRepository[]): GitPullRequest[] => {

        const allPullRequests = this.state.allPullRequests;
        if (!selectedRepositories) {
            return [...allPullRequests];
        }

        const repositoryIds = selectedRepositories.filter(x => x !== null && x !== undefined).map(x => x.id);
        if (repositoryIds.length == 0 || !this.props.filter.hasChangesToReset()) {
            return [...allPullRequests];
        }

        const filteredItems = allPullRequests.filter(item => {
            return repositoryIds.some(repositoryId => repositoryId == item.repository.id);
        });

        return [...filteredItems];
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
}


function getPullRequestStatusIndicatorData(status: PullRequestAsyncStatus): IStatusIndicatorData {
    switch (status) {
        case PullRequestAsyncStatus.NotSet, PullRequestAsyncStatus.Queued:
            return { statusProps: Statuses.Queued, label: "Unknown" }
        case PullRequestAsyncStatus.Conflicts, PullRequestAsyncStatus.Failure, PullRequestAsyncStatus.RejectedByPolicy:
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
        let waitingStatus = Statuses.Waiting;
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