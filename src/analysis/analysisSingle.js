import { useState, useEffect } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { stocks65To70, stocks70To75, stocks75To80, stocks80To100, stocks80To100_2, stocks70To75_2 } from '../constants/stock';

const columns = [
    {
        field: 'profitOrLoss',
        headerName: 'Profit',
        type: 'number',
        width: 150,
    },
    {
        field: 'buyOrSellPrice',
        headerName: 'Buy/Sell Price',
        type: 'number',
        width: 150,
    },
    {
        field: 'direction',
        headerName: 'Direction',
        type: 'string',
        width: 150,
    },
    {
        field: 'target',
        headerName: 'Target',
        type: 'string',
        width: 150,
    },
    {
        field: 'time',
        headerName: 'Date',
        type: 'string',
        width: 150,
    },
];

const AnalyticsSingle = ({ data, analysisFunction, label, name }) => {
    const [result, setResult] = useState([]);
    const [sumResult, setSumResult] = useState(0);

    let stock = [...stocks65To70, ...stocks70To75, ...stocks75To80, ...stocks80To100, ...stocks80To100_2, ...stocks70To75_2];
    let storageAnalysis = localStorage?.getItem('analysis');
    if (!storageAnalysis) {
        localStorage?.setItem('analysis', JSON.stringify({}));
    }
    useEffect(() => {
        let sum = 0;
        result?.forEach((val) => {
            sum = sum + val.profitOrLoss;
        });
        setSumResult(sum);
    }, [result]);

    useEffect(() => {
        let tmpData = data;
        let resultsArray = [];
        while (tmpData.length > 0) {
            let date = tmpData[0]?.date?.split('T');
            let filterData = tmpData.filter((candle) => candle.date.includes(date[0]));
            let dataToAnalys = tmpData.splice(0, filterData.length);
            if (dataToAnalys.length) {
                const ana = analysisFunction(dataToAnalys);
                if (ana.hit === true) {
                    resultsArray.push({ ...ana, id: resultsArray.length + 1 });
                }
            }
        }
        setResult(resultsArray);
    }, [data]);

    const getPer = (data) => {
        let profitStock = data.filter((val) => val.profitOrLoss * 100 / val.buyOrSellPrice > 0.4);
        let percent = (profitStock.length * 100 / data.length).toFixed(1);
        if (stock.includes(name)) {
            let storageAnalysis = JSON.parse(localStorage?.getItem('analysis'));
            const nameData = storageAnalysis[name] ? { ...storageAnalysis[name], [label.trim()]: percent } : { [label.trim()]: percent };
            storageAnalysis = { ...storageAnalysis, [name]: nameData }
            localStorage.setItem('analysis', JSON.stringify(storageAnalysis));
        }
        return percent;
    }

    return (
        <div>
            <div>
                <span>{label}: {sumResult}</span>
                <span style={{ marginLeft: '3rem' }}>Ratio: {(sumResult / result?.length).toFixed(2)}</span>
                <span style={{ marginLeft: '3rem' }}>Percentage: {getPer(result)}%</span>
            </div>
            <div style={{ height: 400 }}>
                <DataGrid
                    rows={result}
                    columns={columns}
                    initialState={{
                        pagination: {
                            paginationModel: { page: 0, pageSize: 50 },
                        },
                    }}
                    pageSizeOptions={[30, 50]}
                    checkboxSelection
                />
            </div>
        </div>
    );
};
export default AnalyticsSingle;