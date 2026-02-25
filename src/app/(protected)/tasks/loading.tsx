export default function TasksLoading() {
    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Tasks</h1>
                    <p className="page-subtitle">
                        Loading tasks…
                    </p>
                </div>
            </div>

            <div className="tasks-loading-skeleton">
                <div className="tasks-loading-toolbar" />
                <div className="tasks-loading-board">
                    {[1, 2, 3].map((col) => (
                        <div key={col} className="tasks-loading-column">
                            <div className="tasks-loading-column-header" />
                            <div className="tasks-loading-column-cards">
                                {[1, 2, 3].map((card) => (
                                    <div key={card} className="tasks-loading-card" />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
