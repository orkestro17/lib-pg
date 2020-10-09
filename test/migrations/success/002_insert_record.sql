-- transaction
begin

-- query 1
insert into test_table (name) values ('Test 1');

-- query 2
insert into test_table (name) values ('Test 2');

--
commit
