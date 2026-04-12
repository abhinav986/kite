import './App.css';
import { Route, Routes } from 'react-router-dom';
import AnalyticsHome from './analysis/analysisHome';
import ScannerHome from "./scanner/scannerHome";

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path='/' element={<ScannerHome/>} />
        <Route path='/listing/:id/:name' element={<AnalyticsHome/>} />
      </Routes>
    </div>
  );
}

export default App;
