import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyState, Loading } from './components/ui';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const StockPoints = lazy(() => import('./pages/StockPoints'));
const StockPointDetail = lazy(() => import('./pages/StockPointDetail'));
const Carriers = lazy(() => import('./pages/Carriers'));
const Hubs = lazy(() => import('./pages/Hubs'));
const DeliveryModes = lazy(() => import('./pages/DeliveryModes'));
const Network = lazy(() => import('./pages/Network'));
const Simulator = lazy(() => import('./pages/Simulator'));
const Scenarios = lazy(() => import('./pages/Scenarios'));
const Benchmarks = lazy(() => import('./pages/Benchmarks'));
const Docs = lazy(() => import('./pages/Docs'));
const Settings = lazy(() => import('./pages/Settings'));
const Zones = lazy(() => import('./pages/Zones'));
const CarrierDetail = lazy(() => import('./pages/CarrierDetail'));
const RouteDetail = lazy(() => import('./pages/RouteDetail'));
const AdditionalServices = lazy(() => import('./pages/AdditionalServices'));
const StockViews = lazy(() => import('./pages/StockViews'));
const Skus = lazy(() => import('./pages/Skus'));

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Lazy el={<Dashboard />} />} />
        <Route path="stock-points" element={<Lazy el={<StockPoints />} />} />
        <Route path="stock-points/:id" element={<Lazy el={<StockPointDetail />} />} />
        <Route path="carriers" element={<Lazy el={<Carriers />} />} />
        <Route path="carriers/:id" element={<Lazy el={<CarrierDetail />} />} />
        <Route path="carriers/:id/routes/new" element={<Lazy el={<RouteDetail />} />} />
        <Route path="carriers/:id/routes/:routeId" element={<Lazy el={<RouteDetail />} />} />
        <Route path="zones" element={<Lazy el={<Zones />} />} />
        <Route path="hubs" element={<Lazy el={<Hubs />} />} />
        <Route path="delivery-modes" element={<Lazy el={<DeliveryModes />} />} />
        <Route path="network" element={<Lazy el={<Network />} />} />
        <Route path="simulator" element={<Lazy el={<Simulator />} />} />
        <Route path="scenarios" element={<Lazy el={<Scenarios />} />} />
        <Route path="benchmarks" element={<Lazy el={<Benchmarks />} />} />
        <Route path="docs" element={<Lazy el={<Docs />} />} />
        <Route path="settings" element={<Lazy el={<Settings />} />} />
        <Route path="additional-services" element={<Lazy el={<AdditionalServices />} />} />
        <Route path="stock-views" element={<Lazy el={<StockViews />} />} />
        <Route path="skus" element={<Lazy el={<Skus />} />} />
        <Route path="*" element={<EmptyState title="Page introuvable">Cette adresse ne correspond à aucun écran.</EmptyState>} />
      </Route>
    </Routes>
  );
}

function Lazy({ el }: { el: JSX.Element }) {
  return <Suspense fallback={<Loading />}>{el}</Suspense>;
}
