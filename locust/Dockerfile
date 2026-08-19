FROM locustio/locust:2.40.5

WORKDIR /home/locust

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY locustfile.py .

EXPOSE 8089

ENTRYPOINT ["locust"]