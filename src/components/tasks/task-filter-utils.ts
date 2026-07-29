export type TaskAdvancedFilters = {
  assignee: string;
  status: string;
  priority: string;
  clientId: string;
  caseId: string;
  overdueOnly: boolean;
  showCompleted: boolean;
  withoutClient: boolean;
  withoutCase: boolean;
};

export function countActiveTaskFilters(
  filters: TaskAdvancedFilters,
  defaultShowCompleted: boolean,
  indicator = "all",
) {
  return (
    [filters.assignee, filters.status, filters.priority, filters.clientId, filters.caseId].filter(
      Boolean,
    ).length +
    Number(filters.overdueOnly) +
    Number(filters.showCompleted !== defaultShowCompleted) +
    Number(filters.withoutClient) +
    Number(filters.withoutCase) +
    Number(indicator !== "all")
  );
}
