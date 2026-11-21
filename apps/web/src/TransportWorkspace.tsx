import React, { useState } from 'react';
import {
  Bus, MapPin, Navigation, Clock, ShieldCheck, AlertTriangle,
  UserCheck, Phone, CheckCircle2, Search, ArrowRight, Gauge
} from 'lucide-react';

interface BusRoute {
  id: string;
  busNumber: string;
  driverName: string;
  driverPhone: string;
  attendantName: string;
  routeCode: string;
  currentStop: string;
  nextStop: string;
  studentsBoarded: number;
  totalCapacity: number;
  speedKmH: number;
  status: 'In Transit' | 'At Stop' | 'Completed' | 'Delay Alert';
  etaMinutes: number;
  stops: { name: string; time: string; passed: boolean }[];
}

const SAMPLE_ROUTES: BusRoute[] = [
  {
    id: 'BUS-01',
    busNumber: 'DL-01-AB-1024',
    driverName: 'Rameshwar Singh',
    driverPhone: '+91 98112 34567',
    attendantName: 'Sunita Devi',
    routeCode: 'Route 4A (Green Park & Hauz Khas)',
    currentStop: 'Green Park Metro Station',
    nextStop: 'Hauz Khas Block C',
    studentsBoarded: 28,
    totalCapacity: 35,
    speedKmH: 26,
    status: 'In Transit',
    etaMinutes: 6,
    stops: [
      { name: 'Depot Start', time: '07:15 AM', passed: true },
      { name: 'South Ext Part 2', time: '07:30 AM', passed: true },
      { name: 'Green Park Metro', time: '07:42 AM', passed: true },
      { name: 'Hauz Khas Block C', time: '07:50 AM', passed: false },
      { name: 'School Campus Gate 2', time: '08:05 AM', passed: false }
    ]
  },
  {
    id: 'BUS-02',
    busNumber: 'DL-01-CD-8842',
    driverName: 'Gurdeep Singh',
    driverPhone: '+91 98450 99123',
    attendantName: 'Kishore Kumar',
    routeCode: 'Route 12B (Vasant Kunj & Saket)',
    currentStop: 'Saket City Mall Crossing',
    nextStop: 'Malviya Nagar Corner',
    studentsBoarded: 32,
    totalCapacity: 32,
    speedKmH: 14,
    status: 'In Transit',
    etaMinutes: 12,
    stops: [
      { name: 'Depot Start', time: '07:10 AM', passed: true },
      { name: 'Vasant Kunj Sector C', time: '07:25 AM', passed: true },
      { name: 'Saket City Mall', time: '07:44 AM', passed: true },
      { name: 'Malviya Nagar Corner', time: '07:55 AM', passed: false },
      { name: 'School Campus Gate 1', time: '08:10 AM', passed: false }
    ]
  },
  {
    id: 'BUS-03',
    busNumber: 'DL-01-XY-5519',
    driverName: 'Mohd. Aslam',
    driverPhone: '+91 97120 44321',
    attendantName: 'Pooja Rawat',
    routeCode: 'Route 8C (Dwarka Express)',
    currentStop: 'Dwarka Sector 11 Market',
    nextStop: 'Dwarka Sector 6 Crossing',
    studentsBoarded: 19,
    totalCapacity: 40,
    speedKmH: 0,
    status: 'At Stop',
    etaMinutes: 2,
    stops: [
      { name: 'Dwarka Sector 21', time: '07:20 AM', passed: true },
      { name: 'Dwarka Sector 11 Market', time: '07:40 AM', passed: true },
      { name: 'Dwarka Sector 6 Crossing', time: '07:52 AM', passed: false },
      { name: 'School Campus Gate 2', time: '08:15 AM', passed: false }
    ]
  }
];

export default function TransportWorkspace() {
  const [routes, setRoutes] = useState<BusRoute[]>(SAMPLE_ROUTES);
  const [selectedRoute, setSelectedRoute] = useState<BusRoute>(SAMPLE_ROUTES[0]);

  return (
    <div style={{ padding: '24px', maxWidth: '1240px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <Bus size={14} /> EduConnect Transport · Simulation with sample data
        </div>
        <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', margin: '4px 0 6px', letterSpacing: '-0.02em' }}>
          Transport Management Preview · GPS and RFID are not connected
        </h1>
        <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
          Sample routes only. Live vehicle telemetry and parent SMS alerts are unavailable until providers are configured.
        </p>
      </div>

      {/* Stats Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Active Fleet on Road</div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>{routes.length} Buses</div>
        </div>
        <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Students Onboard</div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>
            {routes.reduce((acc, r) => acc + r.studentsBoarded, 0)} Students
          </div>
        </div>
        <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Average Route Speed</div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#0284c7', marginTop: '4px' }}>24 km/h</div>
        </div>
        <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Safety Telemetry</div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#15803d', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={22} /> 100% Secure
          </div>
        </div>
      </div>

      {/* Main Grid: Routes List & Live Telemetry Inspector */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '20px' }}>
        {/* Left: Route Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>Active Transport Routes</div>
          {routes.map(route => {
            const isSelected = selectedRoute.id === route.id;
            return (
              <div
                key={route.id}
                onClick={() => setSelectedRoute(route)}
                style={{
                  background: isSelected ? '#f0fdf4' : '#ffffff',
                  border: isSelected ? '2px solid #16a34a' : '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '15px' }}>{route.routeCode}</div>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: 700,
                    background: route.status === 'In Transit' ? '#dcfce7' : '#e0f2fe',
                    color: route.status === 'In Transit' ? '#15803d' : '#0369a1'
                  }}>
                    {route.status}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
                  Vehicle: <strong style={{ color: '#334155' }}>{route.busNumber}</strong> • Driver: {route.driverName}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', background: '#f8fafc', padding: '8px 12px', borderRadius: '8px' }}>
                  <span>Next: <strong>{route.nextStop}</strong></span>
                  <span style={{ fontWeight: 700, color: '#16a34a' }}>ETA ~{route.etaMinutes} mins</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Selected Route Telemetry View */}
        <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px', marginBottom: '20px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>TELEMETRY INSPECTOR // {selectedRoute.id}</div>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>{selectedRoute.routeCode}</h2>
              <div style={{ fontSize: '13px', color: '#64748b' }}>Plate: {selectedRoute.busNumber}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                <Gauge size={20} color="#16a34a" /> {selectedRoute.speedKmH} km/h
              </div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Speed Telemetry</div>
            </div>
          </div>

          {/* Personnel Box */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>DRIVER</div>
              <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>{selectedRoute.driverName}</div>
              <div style={{ fontSize: '11px', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                <Phone size={11} /> {selectedRoute.driverPhone}
              </div>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>ATTENDANT</div>
              <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>{selectedRoute.attendantName}</div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>RFID Attendance Active</div>
            </div>
          </div>

          {/* Simulated Stop Milestones */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '14px' }}>Route Progress &amp; Stop Milestones</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'relative', paddingLeft: '24px' }}>
              <div style={{ position: 'absolute', left: '7px', top: '8px', bottom: '8px', width: '2px', background: '#e2e8f0' }} />
              {selectedRoute.stops.map((stop, idx) => (
                <div key={idx} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                  <div style={{
                    position: 'absolute',
                    left: '-24px',
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: stop.passed ? '#16a34a' : '#ffffff',
                    border: stop.passed ? '2px solid #16a34a' : '2px solid #cbd5e1',
                    display: 'grid',
                    placeItems: 'center'
                  }}>
                    {stop.passed && <CheckCircle2 size={10} color="#ffffff" />}
                  </div>
                  <div>
                    <strong style={{ color: stop.passed ? '#0f172a' : '#64748b' }}>{stop.name}</strong>
                    {stop.name === selectedRoute.nextStop && (
                      <span style={{ marginLeft: '8px', fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                        Next Stop
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>{stop.time}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Live Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f0fdf4', padding: '12px 16px', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: '12px', color: '#15803d' }}>
              <strong>Approaching SMS Alerts:</strong> Triggered automatically when bus is within 500m of stop.
            </div>
            <button
              onClick={() => alert(`Simulated SMS Alert broadcast for ${selectedRoute.routeCode} next stop.`)}
              style={{
                background: '#16a34a',
                color: '#ffffff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Broadcast Alert
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
