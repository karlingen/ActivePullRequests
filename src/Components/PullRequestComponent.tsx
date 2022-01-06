import React from 'react'
import { GitPullRequest } from "azure-devops-extension-api/Git";

interface Props {
    item: GitPullRequest;
    baseUrl: string | undefined;
}

export default class PullRequestComponent extends React.Component<Props, {}> {
    constructor(props) {
        super(props);
    }

    render() {
        const { baseUrl, item } = this.props;
        const { isDraft, title, repository, pullRequestId } = item;
        const href = baseUrl + encodeURIComponent(repository.project.name) + '/_git/' + encodeURIComponent(repository.name) + '/pullRequest/' + pullRequestId;

        return (
            <>
                <a href={href}>{isDraft ? "[DRAFT] " : ""}{title}</a>
            </>
        )
    }
}
