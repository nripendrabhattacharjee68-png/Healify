import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function PhysioDashboard({ patients, chartData, reportUrl, onReportUrlChange, onSendProgress }) {
  return (
    <section className="panel">
      <h2 className="panel-title">Step 5 · Doctor's Command Center</h2>
      <p className="panel-subtitle">
        Target ROM vs Actual ROM monitoring with risk highlighting and one-click family updates.
      </p>

      <div className="chart-shell">
        <ResponsiveContainer width="100%" height={290}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#29465d" />
            <XAxis dataKey="sessionLabel" stroke="#8cb0ca" />
            <YAxis stroke="#8cb0ca" />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="targetROM"
              stroke="#ffb020"
              strokeWidth={3}
              name="Target ROM"
            />
            <Line
              type="monotone"
              dataKey="actualROM"
              stroke="#00ffd5"
              strokeWidth={3}
              name="Actual ROM"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto">
        <table className="patient-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Target ROM</th>
              <th>Actual ROM</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {patients.map((patient) => {
              const belowThreshold = patient.actualROM < patient.targetROM * 0.8;
              return (
                <tr key={patient.id} className={belowThreshold ? 'row-danger' : ''}>
                  <td data-label="Patient">{patient.name}</td>
                  <td data-label="Target ROM">{patient.targetROM.toFixed(1)}°</td>
                  <td data-label="Actual ROM">{patient.actualROM.toFixed(1)}°</td>
                  <td data-label="Status">{belowThreshold ? 'Alert: >20% below target' : 'On Track'}</td>
                  <td data-label="Action">
                    <button
                      className="secondary-btn"
                      type="button"
                      onClick={() => onSendProgress(patient)}
                    >
                      Send Progress to Family
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <label className="field-label" htmlFor="report-url">
          Sunday PDF Link
        </label>
        <input
          id="report-url"
          className="text-input"
          type="url"
          value={reportUrl}
          onChange={(event) => onReportUrlChange(event.target.value)}
          placeholder="https://your-public-report-link.pdf"
        />
      </div>
    </section>
  );
}
