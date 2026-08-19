FROM locustio/locust:2.40.5

WORKDIR /mnt/locust

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY locustfile.py .

USER locust

EXPOSE 8089