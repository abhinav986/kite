import React, { useEffect, useState } from "react";
import { get } from './utils/axios';
import { Link } from "react-router-dom";
import { DataGrid } from '@mui/x-data-grid';
import { stocks, stocks80To100_2, stocks80To100, stocks75To80, stocks70To75, stocks65To70, stocks70To75_2 } from './constants/stock';

const Listing = () => {
    const [data, setData] = useState([]);

    useEffect(() => {
        let stock = [...stocks65To70, ...stocks70To75, ...stocks75To80, ...stocks80To100, ...stocks80To100_2, ...stocks70To75_2];
        get('instruments').then((res) => {
            let filterData = res.data.filter((val) => val.segment === 'NSE' && val.instrument_type === 'EQ' && val.name);
            filterData = filterData.map((val) => ({ ...val, id: val.instrument_token }));
            setData(filterData);
        });
    }, []);

    useEffect(() => {
        let s65To70 = stocks65To70;
        let s70To75 = stocks70To75;
        let s75To80 = stocks75To80;
        let s80To100 = stocks80To100;
        let s80To100_2 = stocks80To100_2;
        let s70To75_2 = stocks70To75_2;
        s65To70 = s65To70.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        s70To75 = s70To75.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        s70To75_2 = s70To75_2.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        s75To80 = s75To80.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        s80To100 = s80To100.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        s80To100_2 = s80To100_2.map((val) => {
            let findStock = data.find((st) => st.name === val);
            return { name: val, instrument_token: findStock?.instrument_token };
        });
        localStorage.setItem('stockNames', JSON.stringify({ stocks65To70: s65To70, stocks70To75: s70To75, stocks75To80: s75To80, stocks80To100: s80To100, stocks80To100_2: s80To100_2, stocks70To75_2: s70To75_2 }));
    }, [data])

    const columns = [
        {
            field: 'instrument_token',
            headerName: 'Token',
            type: 'number',
            width: 150,
        },
        {
            field: 'name',
            headerName: 'Name',
            width: 300,
            renderCell: (params) => <Link to={`/listing/${params.row.instrument_token}/${params.row.name}`} target="_blank">{params.row.name}</Link>,
        },
    ];

    return (
        <div>
            <Link to={`/scannerHome/1`} target="_blank" style={{ marginRight: '12px' }}>Scanner 1</Link>
            <Link to={`/scannerHome/2`} target="_blank" style={{ marginRight: '12px' }}>Scanner 2</Link>
            <Link to={`/scannerHome/3`} target="_blank" style={{ marginRight: '12px' }}>Scanner 3</Link>
            <Link to={`/scannerHome/4`} target="_blank" style={{ marginRight: '12px' }}>Scanner 4</Link>
            <Link to={`/scannerHome/5`} target="_blank" style={{ marginRight: '12px' }}>Scanner 5</Link>
            <Link to={`/scannerHome/6`} target="_blank" style={{ marginRight: '12px' }}>Scanner 6</Link>
            <div style={{ height: 600, width: '100%' }}>
                <DataGrid
                    rows={data}
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
export default Listing;