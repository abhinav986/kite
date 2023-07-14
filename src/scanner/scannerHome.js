import { useEffect, useState } from "react";
import { get } from '../utils/axios';
import { gapOpen, fourInsideOne, firstCandleCrossBothSide, engulfe } from '../utils/analysis';
import { engulfeFirst } from '../utils/analysis2';

import { DataGrid } from '@mui/x-data-grid';
import { Link, useParams } from "react-router-dom";

const columns = [
    {
        field: 'name',
        headerName: 'Name',
        type: 'string',
        width: 150,
        renderCell: (params) => <Link to={`/listing/${params.row.instrument_token}/${params.row.name}`} target="_blank">{params.row.name}</Link>,
    },
    {
        field: 'hit',
        headerName: 'Hit',
        type: 'string',
        width: 150,
    },
    {
        field: 'inProgress',
        headerName: 'Progress',
        type: 'string',
        width: 150,
    },
    {
        field: 'profitOrLoss',
        headerName: 'Profit',
        type: 'number',
        width: 150,
    },
    {
        field: 'direction',
        headerName: 'Direction',
        type: 'string',
        width: 150,
    },
];

const ScannerHome = () => {
    const [data, setData] = useState([]);
    const { id } = useParams();
    const [tracker, setTracker] = useState({
        gap: [],
        engulfe: [],
        firstCross: [],
        oneInsideOther: [],
    });
    let stockList = [];
    let storageAnalysis = JSON.parse(localStorage?.getItem('analysis'));
    let stockNames = JSON.parse(localStorage.getItem('stockNames'));

    if (id == 1) {
        stockList = stockNames?.stocks65To70;
    } else if (id == 2) {
        stockList = stockNames?.stocks70To75;
    } else if (id == 3) {
        stockList = stockNames?.stocks75To80;
    } else if (id == 4) {
        stockList = stockNames?.stocks80To100;
    } else if (id == 5) {
        stockList = stockNames?.stocks80To100_2;
    } else if (id == 6) {
        stockList = stockNames?.stocks70To75_2;
    }

    useEffect(() => {
        stockList = stockList.filter((val) => val.instrument_token).map((val) => get(`historyData/intraday/?id=${val.instrument_token}`).then(r => ({ name: val.name, result: r, instrument_token: val.instrument_token })));
        Promise.allSettled(stockList).then((res) => {
            setData(res);
        });
    }, []);

    useEffect(() => {
        let engulfeArr = [];
        let gap = [];
        let firstCros = [];
        let oneInsideOther = [];

        if (data.length) {
            data.forEach(st => {
                let candles = st?.value?.result?.data;
                let date = candles[0]?.date?.split('T');
                let filterData = candles.filter((candle) => candle.date.includes(date[0]));
                let category = getCategory(st?.value?.name);
                if (candles.length) {
                    let res = engulfe(candles);
                    if (res.inProgress && category.includes('Engulfe total') || category.length === 0) {
                        engulfeArr.push({ id: engulfeArr.length + 1, name: st?.value?.name, instrument_token: st?.value?.instrument_token, ...res });
                    }

                    let resGap = gapOpen(candles);
                    if (Boolean(resGap.inProgress) && category.includes('Gap Open total') || category.length === 0) {
                        gap.push({ id: gap.length + 1, name: st?.value?.name, instrument_token: st?.value?.instrument_token, ...resGap });
                    }

                    let resFirstCross = firstCandleCrossBothSide(candles);
                    if (Boolean(resFirstCross.inProgress) && category.includes('First Cross total') || category.length === 0) {
                        firstCros.push({ id: firstCros.length + 1, name: st?.value?.name, instrument_token: st?.value?.instrument_token, ...resFirstCross });
                    }

                    let resInside = fourInsideOne(candles, previousDayCandles);
                    if (Boolean(resInside.inProgress) && category.includes('Four Inside one total') || category.length === 0) {
                        oneInsideOther.push({ id: oneInsideOther.length + 1, name: st?.value?.name, instrument_token: st?.value?.instrument_token, ...resInside });
                    }
                }
            });
        }
        setTracker({
            gap: gap,
            engulfe: engulfeArr,
            firstCross: firstCros,
            oneInsideOther: oneInsideOther,
        });
    }, [data]);

    const getCategory = (name) => {
        let data = storageAnalysis?.[name];
        let category = [];
        if (data) {
            let keys = Object.keys(data);
            keys.forEach((val) => {
                if (data[val] > 65) {
                    category.push(val);
                }
            });
        }
        return category;
    }

    return (
        <div className='analysis-home'>
            <div>
                <h6>Gap</h6>
                <DataGrid
                    style={{ height: 400 }}
                    rows={[...tracker.gap]}
                    columns={columns}
                />
            </div>
            <div>
                <h6>Engulfe</h6>
                <DataGrid
                    style={{ height: 400 }}
                    rows={[...tracker.engulfe]}
                    columns={columns}
                />
            </div>
            <div>
                <h6>One Inside Other</h6>
                <DataGrid
                    style={{ height: 400 }}
                    rows={[...tracker.oneInsideOther]}
                    columns={columns}
                />
            </div>
            <div>
                <h6>Cross Both Side</h6>
                <DataGrid
                    style={{ height: 400 }}
                    rows={[...tracker.firstCross]}
                    columns={columns}
                />
            </div>
        </div>
    )
}
export default ScannerHome;