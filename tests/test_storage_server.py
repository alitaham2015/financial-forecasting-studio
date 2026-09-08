import copy
import json
import csv
import io
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from studio.finance import calculate
from studio.storage import Store, Conflict, blank_scenario, demo_scenario
from studio.server import create_server


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'scenarios.sqlite3'
        self.store=Store(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_create_edit_delete(self):
        saved=self.store.create(blank_scenario())
        self.assertEqual(saved['revision'],1)
        saved['name']='Edited plan'
        updated=self.store.save(saved['id'],saved,1)
        self.assertEqual(updated['revision'],2)
        self.assertEqual(updated['name'],'Edited plan')
        self.store.delete(saved['id'],2)
        self.assertEqual(self.store.list(),[])

    def test_new_store_instance_retains_confirmed_scenario(self):
        saved=self.store.create(demo_scenario())
        self.store.confirm(saved['id'],1,True)
        reopened=Store(self.path).get(saved['id'])
        self.assertTrue(reopened['confirmed']);self.assertTrue(reopened['warningsAccepted'])
        self.assertEqual(calculate(saved),calculate(reopened))

    def test_actual_new_process_reads_and_recalculates_identically(self):
        saved=self.store.create(demo_scenario())
        code='from studio.storage import Store; from studio.finance import calculate; import sys,json; s=Store(sys.argv[1]).list()[0]; print(json.dumps(calculate(s),sort_keys=True))'
        result=subprocess.run([sys.executable,'-c',code,str(self.path)],check=True,capture_output=True,text=True)
        self.assertEqual(json.loads(result.stdout),calculate(saved))

    def test_edit_recalculates_and_invalidates_confirmation(self):
        saved=self.store.create(demo_scenario());self.store.confirm(saved['id'],1,True)
        old=calculate(saved)
        saved['openingCash']='0.00'
        updated=self.store.save(saved['id'],saved,1)
        new=calculate(updated)
        self.assertFalse(updated['confirmed']);self.assertFalse(updated['warningsAccepted'])
        self.assertFalse(new['summary']['feasible']);self.assertEqual(old['summary']['npv'],new['summary']['npv'])
        self.assertEqual(new['summary']['endingCash'],'14373.67')

    def test_object_edit_changes_result(self):
        saved=self.store.create(demo_scenario())
        saved['objects'][2]['amount']='3300.00'
        updated=self.store.save(saved['id'],saved,1)
        self.assertEqual(calculate(updated)['summary']['endingCash'],'19073.67')

    def test_stale_revision_cannot_overwrite_or_delete(self):
        saved=self.store.create(blank_scenario())
        self.store.save(saved['id'],saved,1)
        with self.assertRaises(Conflict):self.store.save(saved['id'],saved,1)
        with self.assertRaises(Conflict):self.store.delete(saved['id'],1)
        with self.assertRaises(Conflict):self.store.confirm(saved['id'],1,False)

    def test_duplicate_is_independent(self):
        a=self.store.create(demo_scenario());b=self.store.create(a)
        b['objects'][0]['principal']='1000.00'
        self.store.save(b['id'],b,1)
        self.assertEqual(self.store.get(a['id'])['objects'][0]['principal'],'12000.00')
        self.assertNotEqual(a['id'],b['id'])

    def test_custom_copy_preserves_atomic_schedule_but_is_independent(self):
        s=demo_scenario();original=copy.deepcopy(s['objects'][0]);flows=calculate(s)['flows']
        copied={'id':'copied','type':'custom','name':'Negotiated repayments','copiedFrom':original['name'],'rows':[{'date':f['date'],'amount':f['amount'],'note':f['rule']} for f in flows if f['objectId']==original['id']]}
        s['objects'].append(copied)
        saved=self.store.create(s)
        copy_flows=[f for f in calculate(saved)['flows'] if f['objectId']=='copied']
        expected=[(f['date'],f['amount']) for f in flows if f['objectId']==original['id']]
        self.assertEqual([(f['date'],f['amount']) for f in copy_flows],expected)
        saved['objects'][-1]['rows'][1]['amount']='-500.00'
        changed=self.store.save(saved['id'],saved,1)
        self.assertEqual(changed['objects'][0],original)
        self.assertEqual(changed['objects'][-1]['rows'][1]['amount'],'-500.00')

    def test_backup_roundtrip_imports_fresh_drafts(self):
        saved=self.store.create(demo_scenario());self.store.confirm(saved['id'],1,True)
        documents=json.loads(json.dumps(self.store.list()))
        self.assertEqual(self.store.import_many(documents),1)
        copies=[s for s in self.store.list() if s['id']!=saved['id']]
        self.assertEqual(len(copies),1);self.assertFalse(copies[0]['confirmed'])
        self.assertEqual(calculate(copies[0]),calculate(saved))

    def test_import_atomic_rejects_malformed_document(self):
        with self.assertRaises(ValueError):self.store.import_many([demo_scenario(),{'name':'broken'}])
        self.assertEqual(self.store.list(),[])

    def test_financially_invalid_draft_can_be_saved(self):
        s=blank_scenario();s['discountRate']='';s['end']=''
        saved=self.store.create(s)
        self.assertEqual(saved['end'],'');self.assertFalse(saved['confirmed'])


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.server=create_server(0,self.temp.name)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        self.temp.cleanup()

    def request(self,path,method='GET',data=None,headers=None):
        req=Request(self.base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json','X-Studio-Request':'local',**(headers or {})})
        try:
            response=urlopen(req,timeout=10)
        except HTTPError as exc:
            response=exc
        raw=response.read()
        content=json.loads(raw) if 'application/json' in response.headers.get('Content-Type','') else raw
        status, headers = response.status, response.headers
        response.close()
        return status,content,headers

    def test_health_static_local_binding_and_security_headers(self):
        self.assertEqual(self.server.server_address[0],'127.0.0.1')
        self.assertEqual(self.request('/api/health')[0],200)
        status,body,headers=self.request('/')
        self.assertEqual(status,200);self.assertIn(b'Financial Forecasting Studio',body)
        self.assertIn("connect-src 'self'",headers['Content-Security-Policy'])
        self.assertEqual(headers['Cache-Control'],'no-store')
        self.assertNotIn('Access-Control-Allow-Origin',headers)

    def test_http_full_scenario_lifecycle(self):
        status,payload,_=self.request('/api/scenarios','POST',{'template':'demo'})
        self.assertEqual(status,201);s=payload['scenario'];path='/api/scenarios/'+s['id']
        status,r,_=self.request('/api/calculate','POST',{'scenario':s})
        self.assertEqual(status,200);self.assertEqual(r['result']['summary']['npv'],'13561.30')
        self.assertEqual(self.request(path+'/confirm','POST',{'revision':1})[0],409)
        status,r,_=self.request(path+'/confirm','POST',{'revision':1,'acceptWarnings':True})
        self.assertEqual(status,200);self.assertTrue(r['scenario']['confirmed'])
        s['openingCash']='0.00'
        status,r,_=self.request(path,'PUT',{'scenario':s,'revision':1})
        self.assertEqual(status,200);self.assertFalse(r['scenario']['confirmed'])
        self.assertEqual(r['scenario']['revision'],2)
        self.assertEqual(self.request(path,'PUT',{'scenario':s,'revision':1})[0],409)
        status,duplicate,_=self.request(path+'/duplicate','POST',{})
        self.assertEqual(status,201);self.assertNotEqual(duplicate['scenario']['id'],s['id'])
        self.assertEqual(self.request(path,'DELETE',{'revision':2})[0],200)
        self.assertEqual(self.request(path)[0],404)

    def test_confirm_revalidates_saved_draft(self):
        s=blank_scenario();s['discountRate']='-100'
        status,body,_=self.request('/api/scenarios','POST',{'scenario':s});ident=body['scenario']['id']
        self.assertEqual(status,201)
        status,body,_=self.request('/api/scenarios/'+ident+'/confirm','POST',{'revision':1})
        self.assertEqual(status,422);self.assertEqual(body['errors'][0]['path'],'discountRate')

    def test_cross_site_requests_and_rebinding_rejected(self):
        self.assertEqual(self.request('/api/scenarios','POST',{},headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.request('/api/scenarios','POST',{},headers={'X-Studio-Request':''})[0],403)
        self.assertEqual(self.request('/api/scenarios',headers={'Host':'evil.example'})[0],403)
        self.assertEqual(self.request('/api/scenarios','POST',{},headers={'Origin':self.base})[0],201)

    def test_private_files_never_served(self):
        for path in ['/data/scenarios.sqlite3','/../studio/storage.py','/run.py','/docs/FINANCIAL_DECISIONS.md']:
            self.assertEqual(self.request(path)[0],404)

    def test_http_backup_and_import(self):
        self.request('/api/scenarios','POST',{'template':'demo'})
        status,body,headers=self.request('/api/backup')
        self.assertEqual(status,200);self.assertIn('attachment',headers['Content-Disposition'])
        self.assertEqual(self.request('/api/import','POST',body)[1]['imported'],1)
        self.assertEqual(len(self.request('/api/scenarios')[1]['scenarios']),2)
        self.assertEqual(self.request('/api/import','POST',{'format':'unknown'})[0],400)

    def test_csv_exports_complete_schedule_and_preserve_negative_numbers(self):
        _,body,_=self.request('/api/scenarios','POST',{'template':'demo'})
        path='/api/scenarios/'+body['scenario']['id']
        status,raw,headers=self.request(path+'/payments.csv?object=demo-loan')
        self.assertEqual(status,200);self.assertIn('attachment',headers['Content-Disposition'])
        rows=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
        self.assertEqual(len(rows),14);self.assertEqual(rows[-1][4],'-1043.87');self.assertEqual(rows[-1][10],'0.00')
        status,raw,_=self.request(path+'/balance.csv')
        self.assertEqual(status,200)
        rows=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
        self.assertEqual(len(rows),367);self.assertEqual(rows[-1][5],'17873.67')

    def test_csv_formula_like_names_are_neutralized(self):
        doc=demo_scenario();doc['objects'][0]['name']='=1+2'
        _,body,_=self.request('/api/scenarios','POST',{'scenario':doc})
        _,raw,_=self.request('/api/scenarios/'+body['scenario']['id']+'/payments.csv?object=demo-loan')
        rows=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
        self.assertEqual(rows[1][1],"'=1+2")

    def test_malformed_input_is_recoverable(self):
        self.assertEqual(self.request('/api/calculate','POST',{'scenario':None})[0],422)
        self.assertEqual(self.request('/api/scenarios','POST',{'scenario':{'name':'test','objects':[42]}})[0],400)
        self.assertEqual(self.request('/api/health')[0],200)


if __name__=='__main__':unittest.main()
