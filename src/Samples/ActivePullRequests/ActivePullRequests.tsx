import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";

import { Header, TitleSize } from "azure-devops-ui/Header";
import { Page } from "azure-devops-ui/Page";
import { showRootComponent } from "../../Common";
import { getClient, CommonServiceIds, ILocationService, IExtensionDataService, IProjectPageService } from "azure-devops-extension-api";
import { GitRestClient, GitRepository, IdentityRefWithVote } from "azure-devops-extension-api/Git";
import { ConditionalChildren } from "azure-devops-ui/ConditionalChildren";
import { DropdownFilterBarItem } from "azure-devops-ui/Dropdown";
import { FilterBar } from "azure-devops-ui/FilterBar";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import PullRequestsListingPageContent from "./PullRequestsListingPageContent";

import { ObservableValue } from "azure-devops-ui/Core/Observable";
import { IListBoxItem, LoadingCell, ListBoxItemType } from "azure-devops-ui/ListBox";
import { Filter, IFilterItemState } from "azure-devops-ui/Utilities/Filter";
import { DropdownMultiSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { ITableColumn } from "azure-devops-ui/Table";
import Constants from "./Constants";

interface IActivePullRequestsContentState {
    baseUrl: string | undefined;
    allRepositories: GitRepository[];
    title: String;
    repoDropdownItems: IListBoxItem[];
    createdByDropdownItems: IListBoxItem[];
    reviewersDropdownItems: IListBoxItem[];
    otherDropdownItems: IListBoxItem[];
}

class ActivePullRequestsContent extends React.Component<{}, IActivePullRequestsContentState> {
    private _filterToggled = new ObservableValue<boolean | undefined>(false);
    private _repositoryFilter = new Filter();
    private _repositorySelection = new DropdownMultiSelection();
    private _createdBySelection = new DropdownMultiSelection();
    private _reviewersSelection = new DropdownMultiSelection();
    private _otherSelection = new DropdownMultiSelection();
    private _repoItemsLoaded: boolean = false;
    private _preselectedApplied: boolean = false;
    private _usersPreselectedApplied: boolean = false;
    private _waitingForRepoItems: boolean = false;
    private _baseTitle = "Active Pull Requests" + (process.env.NODE_ENV == "development" ? " - DEV" : "");

    private _loadingItem: IListBoxItem = {
        id: "repo-loading",
        type: ListBoxItemType.Loading,
        render: (
            rowIndex: number,
            columnIndex: number,
            tableColumn: ITableColumn<IListBoxItem<{}>>,
            tableItem: IListBoxItem<{}>
        ) => {
            return (
                <LoadingCell
                    key={rowIndex}
                    columnIndex={columnIndex}
                    tableColumn={tableColumn}
                    tableItem={tableItem}
                    onMount={this.onDropdownLoadingMount}
                />
            );
        }
    };

    private _creatorLoadingItem: IListBoxItem = {
        id: "creator-loading",
        type: ListBoxItemType.Loading,
        render: (
            rowIndex: number,
            columnIndex: number,
            tableColumn: ITableColumn<IListBoxItem<{}>>,
            tableItem: IListBoxItem<{}>
        ) => {
            return (
                <LoadingCell
                    key={rowIndex}
                    columnIndex={columnIndex}
                    tableColumn={tableColumn}
                    tableItem={tableItem}
                />
            );
        }
    };

    private _reviewerLoadingItem: IListBoxItem = {
        id: "reviewer-loading",
        type: ListBoxItemType.Loading,
        render: (
            rowIndex: number,
            columnIndex: number,
            tableColumn: ITableColumn<IListBoxItem<{}>>,
            tableItem: IListBoxItem<{}>
        ) => {
            return (
                <LoadingCell
                    key={rowIndex}
                    columnIndex={columnIndex}
                    tableColumn={tableColumn}
                    tableItem={tableItem}
                />
            );
        }
    };

    constructor(props: {}) {
        super(props);

        this.state = {
            baseUrl: undefined,
            allRepositories: [],
            title: this._baseTitle,
            repoDropdownItems: [this._loadingItem],
            createdByDropdownItems: [this._creatorLoadingItem],
            reviewersDropdownItems: [this._reviewerLoadingItem],
            otherDropdownItems: [
                { id: "other-header", text: "", type: ListBoxItemType.Header },
                { id: "other-draft", text: "Is Draft", data: "isDraft", type: ListBoxItemType.Row },
            ]
        };
    }

    public async componentDidMount() {
        SDK.init();

        // Setup services
        const locationService = await SDK.getService<ILocationService>(CommonServiceIds.LocationService);
        const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
        const gitRestClient: GitRestClient = getClient(GitRestClient);

        const currentProject = await projectService.getProject();
        const allRepositories = (await gitRestClient.getRepositories())
            .filter(function (repo) { return repo.project.id == currentProject?.id; })
            .sort(function (repoA, repoB) { return (repoA.name > repoB.name) ? 1 : ((repoB.name > repoA.name) ? -1 : 0); });

        const currentLocation = await locationService.getResourceAreaLocation(GitRestClient.RESOURCE_AREA_ID);
        this.setState({ baseUrl: currentLocation, allRepositories })
    }

    public componentDidUpdate(prevProps: Readonly<{}>, prevState: Readonly<IActivePullRequestsContentState>): void {
        if (!this._repoItemsLoaded && this._waitingForRepoItems && prevState.allRepositories !== this.state.allRepositories && this.state.allRepositories.length > 0) {
            this.populateRepositoryDropdown();
        }
    }

    public render(): JSX.Element {
        return (
            <Surface background={SurfaceBackground.neutral}>
                <Page className="flex-grow">
                    <Header title={this.state.title} titleSize={TitleSize.Large} commandBarItems={this.getCommandBarItems()} />

                    <ConditionalChildren renderChildren={this._filterToggled}>
                        <div className="page-content-left page-content-right page-content-top">
                            <FilterBar
                                filter={this._repositoryFilter}
                                hideClearAction={true}
                                onDismissClicked={this.onFilterBarDismissClicked}>
                                <DropdownFilterBarItem
                                    filterItemKey={Constants.RepositoriesFilterKey}
                                    filter={this._repositoryFilter}
                                    items={this.state.repoDropdownItems}
                                    selection={this._repositorySelection}
                                    showFilterBox={true}
                                    placeholder="Repositories"
                                    showPlaceholderAsLabel={true}
                                    noItemsText={"No items"}
                                />
                                <DropdownFilterBarItem
                                    filterItemKey={Constants.CreatedByFilterKey}
                                    filter={this._repositoryFilter}
                                    items={this.state.createdByDropdownItems}
                                    selection={this._createdBySelection}
                                    showFilterBox={true}
                                    placeholder="Created By"
                                    showPlaceholderAsLabel={true}
                                    noItemsText={"No items"}
                                />
                                <DropdownFilterBarItem
                                    filterItemKey={Constants.ReviewersFilterKey}
                                    filter={this._repositoryFilter}
                                    items={this.state.reviewersDropdownItems}
                                    selection={this._reviewersSelection}
                                    showFilterBox={true}
                                    placeholder="Reviewers"
                                    showPlaceholderAsLabel={true}
                                    noItemsText={"No items"}
                                />
                                <DropdownFilterBarItem
                                    filterItemKey={Constants.OtherFilterKey}
                                    filter={this._repositoryFilter}
                                    items={this.state.otherDropdownItems}
                                    selection={this._otherSelection}
                                    showFilterBox={false}
                                    placeholder="Other"
                                    showPlaceholderAsLabel={true}
                                    noItemsText={"No items"}
                                />
                            </FilterBar>
                        </div>
                    </ConditionalChildren>

                    <div className="page-content page-content-top">
                        <PullRequestsListingPageContent
                            filter={this._repositoryFilter}
                            filterByPersistedRepositories={() => this.filterByPersistedFilters()}
                            baseUrl={this.state.baseUrl}
                            showOnlyCurrentUser={false}
                            updatePullrequestCount={(count) => this.updatePullRequestCount(count)}
                            updateUsers={this.updateUsers}
                        />
                    </div>
                </Page>
            </Surface>
        );
    }

    private filterByPersistedFilters = async (): Promise<void> => {
        const extDataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
        const context = SDK.getExtensionContext();
        const accessToken = await SDK.getAccessToken();
        const dataManager = await extDataService.getExtensionDataManager(context.publisherId + "." + context.extensionId, accessToken);
        
        // Load persisted repositories filter
        const persistedRepositoriesState: IFilterItemState | null = await dataManager.getValue(Constants.UserRepositoriesKey, { scopeType: "User" });
        if (persistedRepositoriesState !== null && persistedRepositoriesState !== undefined) {
            this._repositoryFilter.setFilterItemState(Constants.RepositoriesFilterKey, persistedRepositoriesState);
        }
        
        // Note: User filters (createdBy, reviewers) are loaded with normalization by applyPersistedUserSelections
        // which is called from updateUsers callback. We don't load them here to avoid duplication.
        
        // Load persisted other filter (doesn't need normalization)
        const persistedOtherState: IFilterItemState | null = await dataManager.getValue(Constants.UserOtherKey, { scopeType: "User" });
        if (persistedOtherState !== null && persistedOtherState !== undefined) {
            this._repositoryFilter.setFilterItemState(Constants.OtherFilterKey, persistedOtherState);
        }
    }

    private onFilterBarDismissClicked = () => {
        this._filterToggled.value = !this._filterToggled.value;
    };

    private getCommandBarItems = () => {
        return [
            {
                id: "filter",
                text: "Filter",
                onActivate: () => { this._filterToggled.value = !this._filterToggled.value; },
                iconProps: { iconName: "Filter" },
                important: true,
            }
        ];
    };

    private onDropdownLoadingMount = async () => {
        if (this._repoItemsLoaded) {
            return;
        }

        const repositories = this.state.allRepositories || [];
        if (repositories.length === 0) {
            // Wait until repositories arrive, then populate in componentDidUpdate
            this._waitingForRepoItems = true;
            return;
        }

        // Repos are already available; populate immediately
        this.populateRepositoryDropdown();
    }

    private populateRepositoryDropdown() {
        const repositories = this.state.allRepositories || [];
        this._repoItemsLoaded = true;
        this._waitingForRepoItems = false;

        let items: IListBoxItem[] = [
            { id: "repo-header", text: "", type: ListBoxItemType.Header },
            ...repositories.map(repo => ({ id: `repo-${repo.id}`, text: repo.name, data: repo, type: ListBoxItemType.Row }))
        ];

        this.setState({ repoDropdownItems: items }, () => {
            if (!this._preselectedApplied) {
                this.applyPersistedRepoSelection(repositories);
                this._preselectedApplied = true;
            }
        });
    }

    private applyPersistedRepoSelection = async (repositories: GitRepository[]) => {
        const extDataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
        const context = SDK.getExtensionContext();
        const accessToken = await SDK.getAccessToken();
        const dataManager = await extDataService.getExtensionDataManager(context.publisherId + "." + context.extensionId, accessToken);
        const persistedState: IFilterItemState | null = await dataManager.getValue(Constants.UserRepositoriesKey, { scopeType: "User" });

        // Normalize persisted repo references to the current GitRepository objects
        let normalizedSelectedRepositoryIds = new Set<string>();
        let normalizedState: IFilterItemState | null = null;
        if (persistedState) {
            const persistedRepositories: GitRepository[] | undefined = (persistedState as any)?.value;
            const selectedRepositoryIds = (persistedRepositories ?? [])
                .filter(repo => !!repo && !!(repo as any).id)
                .map(repo => (repo as any).id as string);

            const repositoryById: { [id: string]: GitRepository } = {};
            repositories.forEach(repo => { repositoryById[repo.id] = repo; });

            const normalizedRepositories: GitRepository[] = selectedRepositoryIds
                .map(id => repositoryById[id])
                .filter((repo): repo is GitRepository => !!repo);

            normalizedSelectedRepositoryIds = new Set<string>(normalizedRepositories.map(repo => repo.id));
            normalizedState = { ...(persistedState as any), value: normalizedRepositories } as IFilterItemState;

            // Update filter with normalized value so DropdownFilterBarItem won't clear selection on open
            this._repositoryFilter.setFilterItemState(Constants.RepositoriesFilterKey, normalizedState);
        }
    }

    private updatePullRequestCount(count: number) {
        this.setState({ title: this._baseTitle + ` (${count})` })
    }

    private updateUsers = async (creators: IdentityRefWithVote[], reviewers: IdentityRefWithVote[]): Promise<void> => {
        const creatorItems: IListBoxItem[] = [
            { id: "creator-header", text: "", type: ListBoxItemType.Header },
            ...creators.map(user => ({
                id: `creator-${user.id}`,
                text: user.displayName || user.uniqueName || user.id,
                data: user,
                type: ListBoxItemType.Row
            }))
        ];

        const reviewerItems: IListBoxItem[] = [
            { id: "reviewer-header", text: "", type: ListBoxItemType.Header },
            ...reviewers.map(user => ({
                id: `reviewer-${user.id}`,
                text: user.displayName || user.uniqueName || user.id,
                data: user,
                type: ListBoxItemType.Row
            }))
        ];

        return new Promise<void>((resolve) => {
            this.setState({
                createdByDropdownItems: creatorItems,
                reviewersDropdownItems: reviewerItems
            }, async () => {
                if (!this._usersPreselectedApplied) {
                    await this.applyPersistedUserSelections(creators, reviewers);
                    this._usersPreselectedApplied = true;
                }
                resolve();
            });
        });
    }

    private applyPersistedUserSelections = async (creators: IdentityRefWithVote[], reviewers: IdentityRefWithVote[]) => {
        const extDataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
        const context = SDK.getExtensionContext();
        const accessToken = await SDK.getAccessToken();
        const dataManager = await extDataService.getExtensionDataManager(context.publisherId + "." + context.extensionId, accessToken);
        
        // Load and normalize persisted createdBy filter
        const persistedCreatedByState: IFilterItemState | null = await dataManager.getValue(Constants.UserCreatedByKey, { scopeType: "User" });
        if (persistedCreatedByState) {
            const persistedCreators: IdentityRefWithVote[] | undefined = (persistedCreatedByState as any)?.value;
            const selectedCreatorIds = (persistedCreators ?? [])
                .filter(user => !!user && !!(user as any).id)
                .map(user => (user as any).id as string);

            const creatorById: { [id: string]: IdentityRefWithVote } = {};
            creators.forEach(user => { creatorById[user.id] = user; });

            const normalizedCreators: IdentityRefWithVote[] = selectedCreatorIds
                .map(id => creatorById[id])
                .filter((user): user is IdentityRefWithVote => !!user);

            if (normalizedCreators.length > 0) {
                const normalizedState = { ...(persistedCreatedByState as any), value: normalizedCreators } as IFilterItemState;
                this._repositoryFilter.setFilterItemState(Constants.CreatedByFilterKey, normalizedState);
            }
        }
        
        // Load and normalize persisted reviewers filter
        const persistedReviewersState: IFilterItemState | null = await dataManager.getValue(Constants.UserReviewersKey, { scopeType: "User" });
        if (persistedReviewersState) {
            const persistedReviewers: IdentityRefWithVote[] | undefined = (persistedReviewersState as any)?.value;
            const selectedReviewerIds = (persistedReviewers ?? [])
                .filter(user => !!user && !!(user as any).id)
                .map(user => (user as any).id as string);

            const reviewerById: { [id: string]: IdentityRefWithVote } = {};
            reviewers.forEach(user => { reviewerById[user.id] = user; });

            const normalizedReviewers: IdentityRefWithVote[] = selectedReviewerIds
                .map(id => reviewerById[id])
                .filter((user): user is IdentityRefWithVote => !!user);

            if (normalizedReviewers.length > 0) {
                const normalizedState = { ...(persistedReviewersState as any), value: normalizedReviewers } as IFilterItemState;
                this._repositoryFilter.setFilterItemState(Constants.ReviewersFilterKey, normalizedState);
            }
        }
        
        // Load persisted other filter (no normalization needed for simple values)
        const persistedOtherState: IFilterItemState | null = await dataManager.getValue(Constants.UserOtherKey, { scopeType: "User" });
        if (persistedOtherState) {
            this._repositoryFilter.setFilterItemState(Constants.OtherFilterKey, persistedOtherState);
        }
    }
}

showRootComponent(<ActivePullRequestsContent />);