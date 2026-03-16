import { useMetrics } from './hooks/useMetrics';
import { Header } from './components/Header';
import { TokenUsageCard } from './components/TokenUsageCard';
import { TodayCard } from './components/TodayCard';
import { CostBreakdownCard } from './components/CostBreakdownCard';
import { SessionsCard } from './components/SessionsCard';
import { TaskLogCard } from './components/TaskLogCard';
import { ActivityCard } from './components/ActivityCard';
import { Footer } from './components/Footer';

export function App() {
  const { data } = useMetrics();

  const activity = data?.activity;
  const sessions = data?.status?.sessions?.recent ?? [];

  return (
    <>
      <div className="scanline" />
      <div className="dashboard">
        <Header data={data} />
        <div className="grid">
          <TokenUsageCard usageCost={data?.usageCost} />
          <TodayCard usageCost={data?.usageCost} hourlyActivity={activity?.hourlyActivity} />
          <CostBreakdownCard totals={data?.usageCost?.totals} />
          <SessionsCard sessions={sessions} />
          <TaskLogCard tasks={activity?.tasks ?? []} />
          <ActivityCard recent={activity?.recent ?? []} />
        </div>
        <Footer timestamp={data?.timestamp} system={data?.system} />
      </div>
    </>
  );
}
