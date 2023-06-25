import './App.css';
import { Route, Routes } from 'react-router-dom';
import Listing from './listing';
import AnalyticsHome from './analysis/analysisHome';
import ScannerHome from "./scanner/scannerHome";

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path='/' element={<Listing/>} />
        <Route path='/listing/:id/:name' element={<AnalyticsHome/>} />
        <Route path='/scannerHome/:id' element={<ScannerHome/>} />
      </Routes>
    </div>
  );
}

export default App;
