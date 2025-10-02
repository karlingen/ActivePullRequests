import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";

import { Header, TitleSize } from "azure-devops-ui/Header";
import { Page } from "azure-devops-ui/Page";
import { showRootComponent } from "../../Common";
import { getClient, CommonServiceIds, ILocationService, IExtensionDataService, IProjectPageService } from "azure-devops-extension-api";
import { HeaderCommandBarWithFilter } from "azure-devops-ui/HeaderCommandBar";
import { GitRestClient, GitRepository } from "azure-devops-extension-api/Git";
import { ConditionalChildren } from "azure-devops-ui/ConditionalChildren";
import { DropdownFilterBarItem } from "azure-devops-ui/Dropdown";
import { FilterBar } from "azure-devops-ui/FilterBar";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import { Tab, TabBar } from "azure-devops-ui/Tabs";
import PullRequestsListingPageContent from "./PullRequestsListingPageContent";
import { Observer } from "azure-devops-ui/Observer";

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
}

class TabTypes {
    public static readonly All = "all";
    public static readonly Mine = "mine";
}

class ActivePullRequestsContent extends React.Component<{}, IActivePullRequestsContentState> {
    private _selectedTabId = new ObservableValue<string>(TabTypes.All);
    private _filterToggled = new ObservableValue<boolean | undefined>(false);
    private _repositoryFilter = new Filter();
    private _repositorySelection = new DropdownMultiSelection();
    private _repoItemsLoaded: boolean = false;
    private _preselectedApplied: boolean = false;
    private _waitingForRepoItems: boolean = false;
    private _baseTitle = "Active Pull Requests" + (process.env.NODE_ENV == "development" ? " - DEV" : "");

    private _loadingItem: IListBoxItem = {
        id: "loading",
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

    constructor(props: {}) {
        super(props);

        this.state = {
            baseUrl: undefined,
            allRepositories: [],
            title: this._baseTitle,
            repoDropdownItems: []
        };

        // Initialize items with a single loading row; real items are set on first open
        this.state.repoDropdownItems.push(this._loadingItem);
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
                    <Header title={this.state.title} titleSize={TitleSize.Large} className={"margin-bottom-8"} />

                    <TabBar
                        selectedTabId={this._selectedTabId}
                        onSelectedTabChanged={this.onSelectedTabChanged}
                        renderAdditionalContent={this.renderTabBarCommands}
                        disableSticky={true}>
                        <Tab id={TabTypes.All} name="All" />
                        <Tab id={TabTypes.Mine} name="Mine" />
                    </TabBar>

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
                            </FilterBar>
                        </div>
                    </ConditionalChildren>

                    <div className="page-content page-content-top">
                        <Observer selectedTabId={this._selectedTabId}>
                            {(props: { selectedTabId: string }) => {
                                return props.selectedTabId == TabTypes.All ? (
                                    <PullRequestsListingPageContent
                                        key={`${TabTypes.All}-list`}
                                        filter={this._repositoryFilter}
                                        filterByPersistedRepositories={() => this.filterByPersistedRepositories()}
                                        baseUrl={this.state.baseUrl}
                                        showOnlyCurrentUser={false}
                                        updatePullrequestCount={(count) => this.updatePullRequestCount(count)}
                                    />
                                ) : (
                                    <PullRequestsListingPageContent
                                        key={`${TabTypes.Mine}-list`}
                                        filter={this._repositoryFilter}
                                        filterByPersistedRepositories={() => this.filterByPersistedRepositories()}
                                        baseUrl={this.state.baseUrl}
                                        showOnlyCurrentUser={true}
                                        updatePullrequestCount={(count) => this.updatePullRequestCount(count)}
                                    />
                                )
                            }}
                        </Observer>

                    </div>
                </Page>
            </Surface>
        );
    }

    private filterByPersistedRepositories = async () => {
        const extDataService = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
        const context = SDK.getExtensionContext();
        const accessToken = await SDK.getAccessToken();
        const dataManager = await extDataService.getExtensionDataManager(context.publisherId + "." + context.extensionId, accessToken);
        const persistedState: IFilterItemState | null = await dataManager.getValue(Constants.UserRepositoriesKey, { scopeType: "User" });
        if (persistedState !== null && persistedState !== undefined) {
            this._repositoryFilter.setFilterItemState(Constants.RepositoriesFilterKey, persistedState);
        } else {
            this._repositoryFilter.reset();
        }
    }

    private onFilterBarDismissClicked = () => {
        this._filterToggled.value = !this._filterToggled.value;
    };

    private renderTabBarCommands = () => {
        return (
            <HeaderCommandBarWithFilter
                filter={this._repositoryFilter}
                filterToggled={this._filterToggled}
                items={[]}
            />
        );
    };

    private onSelectedTabChanged = (newTabId: string) => {
        this._selectedTabId.value = newTabId;
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
            { id: "header", text: "", type: ListBoxItemType.Header },
            ...repositories.map(repo => ({ id: repo.id, text: repo.name, data: repo, type: ListBoxItemType.Row }))
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
}

showRootComponent(<ActivePullRequestsContent />);