/** Rentio module screens, addressed as /o/:org/w/:ws/<module>/<page>. */
import type { ComponentType } from 'react';
import ControlTower from './pages/ControlTower';
import MyWork from './pages/MyWork';
import Journey from './pages/Journey';
import PeriodClose from './pages/PeriodClose';
import Approvals from './pages/Approvals';
import Alerts from './pages/Alerts';
import Decisions from './pages/Decisions';
import RouteSetup from './pages/RouteSetup';
import Intake from './pages/Intake';
import StageBoard from './pages/StageBoard';
import StageWork from './pages/StageWork';
import Grading from './pages/Grading';
import Handovers from './pages/Handovers';
import DailyClose from './pages/DailyClose';
import Godowns from './pages/Godowns';
import Inventory from './pages/Inventory';
import Byproducts from './pages/Byproducts';
import HoldsCounts from './pages/HoldsCounts';
import Orders from './pages/Orders';
import Distributors from './pages/Distributors';
import Logistics from './pages/Logistics';
import Salesman from './pages/Salesman';
import Returns from './pages/Returns';
import Tally from './pages/Tally';
import Reports from './pages/Reports';
import Attendance from './pages/Attendance';
import Season from './pages/Season';

export const RENTIO_PAGES: Record<string, ComponentType> = {
  'home/my-work': MyWork,
  'presenter/journey': Journey,
  'home/approvals': Approvals,
  'home/alerts': Alerts,
  'home/decisions': Decisions,
  'masters/route': RouteSetup,
  'procurement/intake': Intake,
  'production/stages': StageBoard,
  'production/stage': StageWork,
  'production/grading': Grading,
  'production/handovers': Handovers,
  'production/close': DailyClose,
  'stock/godowns': Godowns,
  'stock/inventory': Inventory,
  'stock/byproducts': Byproducts,
  'stock/holds': HoldsCounts,
  'distribution/orders': Orders,
  'distribution/distributors': Distributors,
  'distribution/logistics': Logistics,
  'sales/salesman': Salesman,
  'sales/returns': Returns,
  'finance/tally': Tally,
  'finance/reports': Reports,
  'finance/close': PeriodClose,
  'hr/attendance': Attendance,
  'planning/season': Season,
};

export const RentioDashboard = ControlTower;
